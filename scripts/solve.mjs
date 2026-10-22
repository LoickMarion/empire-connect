// Finds the shortest solutions to a connect-the-provinces puzzle by breadth-first search, using the
// same solver as the app (src/game/solver.js).
//
//   node scripts/solve.mjs "Lisbon" "São Paulo"          shortest routes between two cities
//   node scripts/solve.mjs "Paris, France" "Delhi" --k 5 up to 5 of the most different routes
//   node scripts/solve.mjs --random                      pick a puzzle the way the game does
//   node scripts/solve.mjs --stats 200                   distance statistics over random puzzles
//
// Options: --k N (solutions to show, default 3), --min N / --max N (random puzzle distance, 3 and 7).
// A city can be qualified with its country: "Cork, Ireland".
import path from 'node:path'
import Database from 'better-sqlite3'
import { expandWithRealms } from '../src/game/realms.js'
import { createGraph, describePaths, diversePaths, pickGamePair, shortestPaths } from '../src/game/solver.js'
import { formatYear } from '../src/game/formatYear.js'

const ROOT = new URL('../', import.meta.url).pathname
const db = new Database(path.join(ROOT, 'public/data/empire-connect.sqlite'), { readonly: true })

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1] === undefined || args[i + 1].startsWith('--') ? true : args[i + 1]
}
const positional = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1]?.startsWith('--') && args[i - 1] !== '--random'))

const provinces = db.prepare('SELECT id, city_name AS name, country, region, continent FROM province').all()
const byId = new Map(provinces.map((p) => [p.id, p]))
const holdings = db
  .prepare(
    `SELECT o.province_id AS city, k.id AS empireId, k.name AS nation, k.is_nation AS isNation, o.start_year AS start,
            COALESCE(o.end_year, 2025) AS end
     FROM occupation o JOIN occupier k ON k.id = o.occupier_id`,
  )
  .all()
  .map((r) => ({ ...r, isNation: !!r.isNation }))
const links = db
  .prepare(
    `SELECT l.occupier_id AS occupierId, l.overlord_id AS overlordId, k.name AS overlordName, l.start_year AS start, l.end_year AS end
     FROM realm_link l JOIN occupier k ON k.id = l.overlord_id`,
  )
  .all()
const graph = createGraph(expandWithRealms(holdings, links))

const fold = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
function findProvince(query) {
  const [name, country] = query.split(',').map((s) => fold(s))
  const matches = provinces.filter((p) => fold(p.name) === name && (!country || fold(p.country) === country))
  if (!matches.length) {
    console.error(`no province with the city "${query}"`)
    process.exit(1)
  }
  if (matches.length > 1) console.error(`"${query}" matches ${matches.length} provinces (${matches.map((m) => `${m.country}/${m.region}`).join('; ')}); using the first. Add ", Country" to choose.`)
  return matches[0]
}

const label = (id) => `${byId.get(id).name} (${byId.get(id).country})`
const span = (c) => `${formatYear(c.overlapStart)}–${c.overlapEnd >= 2025 ? 'present' : formatYear(c.overlapEnd)}`

function solve(startId, targetId) {
  const result = shortestPaths(graph, startId, targetId)
  console.log(`\n${label(startId)} [${byId.get(startId).continent}]  →  ${label(targetId)} [${byId.get(targetId).continent}]`)
  if (!result) return console.log('  no connection')
  const k = Number(flag('k', 3))
  console.log(`  shortest distance: ${result.distance} steps; ${result.total.toLocaleString()} shortest route${result.total === 1 ? '' : 's'} exist${result.total === 1 ? 's' : ''}`)
  const chosen = diversePaths(result.paths, k, graph, (id) => byId.get(id)?.country)
  describePaths(graph, chosen).forEach(({ path, steps }, i) => {
    console.log(`\n  Solution ${i + 1}`)
    console.log(`    ${label(path[0])}`)
    for (const s of steps) {
      const via = [s.connection.viaA && `${byId.get(s.from).name} was ${s.connection.viaA}`, s.connection.viaB && `${byId.get(s.to).name} was ${s.connection.viaB}`].filter(Boolean).join(', ')
      console.log(`      └ via ${s.connection.nation} (${span(s.connection)})${via ? ` [${via}]` : ''}`)
      console.log(`    ${label(s.to)}`)
    }
  })
}

if (flag('stats', false)) {
  const n = Number(flag('stats', 100))
  const min = Number(flag('min', 3))
  const max = Number(flag('max', 7))
  const counts = {}
  let failures = 0
  const t0 = Date.now()
  for (let i = 0; i < n; i += 1) {
    const pair = pickGamePair(graph, provinces, { min, max })
    if (!pair) failures += 1
    else counts[pair.distance] = (counts[pair.distance] ?? 0) + 1
  }
  console.log(`${n} puzzles in ${Date.now() - t0} ms (${failures} failed)`)
  for (const d of Object.keys(counts).sort()) console.log(`  ${d} steps: ${counts[d]}`)
} else if (flag('random', false)) {
  const pair = pickGamePair(graph, provinces, { min: Number(flag('min', 3)), max: Number(flag('max', 7)) })
  if (!pair) {
    console.error('could not find a puzzle in that range')
    process.exit(1)
  }
  solve(pair.start, pair.target)
} else if (positional.length === 2) {
  solve(findProvince(positional[0]).id, findProvince(positional[1]).id)
} else {
  console.error('usage: node scripts/solve.mjs "<city>" "<city>" [--k N]  |  --random [--min N --max N]  |  --stats N')
  process.exit(1)
}
