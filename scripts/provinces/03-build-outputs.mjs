// Builds the files the app loads: public/data/empire-connect.sqlite (province, occupier,
// occupation) and public/data/provinces.geojson (province boundaries). Always rebuilds
// from scratch.
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { makeSlugger } from '../import/lib/slugify.mjs'

const ROOT = new URL('../../', import.meta.url).pathname
const RAW = path.join(ROOT, 'data/raw')
const OUT = path.join(ROOT, 'public/data')
const DB_FILE = path.join(OUT, 'empire-connect.sqlite')

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))

// Peoples, cultures and generic labels that were never nations (see non-nations.json).
const nonNations = readJson(new URL('./non-nations.json', import.meta.url).pathname)
const nonNationPatterns = nonNations.patterns.map((p) => new RegExp(p, 'i'))
const nonNationNames = new Set(nonNations.names.map((n) => n.trim().toLowerCase()))
const isNation = (name) => !(nonNationNames.has(name.trim().toLowerCase()) || nonNationPatterns.some((p) => p.test(name)))

// --- map colours ---------------------------------------------------------------------------
function hslToRgb(h, s, l) {
  s /= 100
  l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)].map((x) => Math.round(255 * x))
}
const toHex = (rgb) => `#${rgb.map((x) => x.toString(16).padStart(2, '0')).join('')}`
const fromHex = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
// Perceptual distance (CIE76 delta-E in Lab space): two greens a few RGB units apart can look the same,
// so distinctness is judged in Lab rather than RGB.
function toLab([r, g, b]) {
  const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}
const rgbDistance = (a, b) => {
  const [l1, a1, b1] = toLab(a)
  const [l2, a2, b2] = toLab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

// Colours for every occupier. The most widespread nations go first, each taking the candidate colour
// that is farthest from everything already chosen (so they are all clearly different from each
// other and from the fixed colours); the long tail just gets varied colours that avoid the fixed
// ones. Candidates sweep hue by the golden angle while saturation and lightness wander through
// their own ranges, which gives far more distinguishable colours than hue alone.
function pickColors(names, fixed) {
  const candidate = (i) => hslToRgb((i * 137.508) % 360, 45 + ((i * 37) % 50), 30 + ((i * 23) % 34))
  const taken = [...fixed.values()].map(fromHex)
  const out = new Map(fixed)
  const PROMINENT = 200
  const CANDIDATES = 90
  let next = 0
  let placed = 0
  for (const name of names) {
    if (out.has(name)) continue
    let rgb
    if (placed < PROMINENT) {
      let best = -1
      for (let k = 0; k < CANDIDATES; k += 1) {
        const c = candidate(next + k)
        const d = Math.min(...taken.map((t) => rgbDistance(c, t)))
        if (d > best) {
          best = d
          rgb = c
        }
      }
      taken.push(rgb)
      next += CANDIDATES
    } else {
      rgb = candidate(next)
      for (let k = 1; k < 20 && fixed.size && [...fixed.values()].some((h) => rgbDistance(rgb, fromHex(h)) < 25); k += 1) rgb = candidate(next + k)
      next += 1
    }
    placed += 1
    out.set(name, toHex(rgb))
  }
  return out
}

// Colony -> overlord links (overlords.json), chained: if A was a colony of B and B a dependency of
// C over overlapping years, then A also rolls up to C for the overlap.
function buildRealmLinks(config, occupierIds) {
  const byLower = new Map([...occupierIds.entries()].map(([name, id]) => [name.toLowerCase(), id]))
  const links = []
  const seen = new Set()
  const push = (a, b, s, e, kind = 'subject') => {
    const key = `${a}|${b}|${s}|${e}`
    if (a === b || s > e || seen.has(key)) return false
    seen.add(key)
    links.push({ occupierId: a, overlordId: b, start: s, end: e, kind })
    return true
  }
  const missing = new Set()
  for (const [colony, from, to, overlord, kind] of config.links) {
    const a = byLower.get(colony.toLowerCase())
    const b = byLower.get(overlord.toLowerCase())
    if (!a) missing.add(colony)
    else if (!b) missing.add(`${overlord} (overlord)`)
    else push(a, b, from, to, kind ?? 'subject')
  }
  if (missing.size) console.log(`overlords.json: not in the data (no spans): ${[...missing].join(', ')}`)
  for (let round = 0; round < 5; round += 1) {
    let added = 0
    for (const x of [...links]) {
      for (const y of [...links]) {
        if (x.overlordId !== y.occupierId) continue
        // a chain is a subject link if either step is
        const kind = x.kind === 'subject' || y.kind === 'subject' ? 'subject' : 'member'
        if (push(x.occupierId, y.overlordId, Math.max(x.start, y.start), Math.min(x.end, y.end), kind)) added += 1
      }
    }
    if (!added) break
  }
  return links
}

// Continent of each province: Natural Earth's continent for its country, with the cases where a
// country straddles two (Russia, Turkey, Egypt) decided by where the province lies.
function continentOf(province, byCountry) {
  const [lon, lat] = province.seed
  if (province.country === 'Russia') return lon >= 60 ? 'Asia' : 'Europe'
  if (province.country === 'Turkey') return ['East Thrace', 'Istanbul'].includes(province.region) ? 'Europe' : 'Asia'
  if (province.country === 'Egypt' && lon > 32.5 && lat > 27.5 && lat < 32) return 'Asia' // Sinai
  if (province.country === 'Kazakhstan' && lon < 50) return 'Europe'
  return byCountry.get(province.country) ?? (['England', 'Scotland', 'Wales', 'Northern Ireland', 'Ireland'].includes(province.country) ? 'Europe' : null)
}

function main() {
  const geometry = readJson(path.join(RAW, 'provinces.json'))
  const { provinces, occupations } = readJson(path.join(RAW, 'province-data.json'))

  const slug = makeSlugger()
  const occupierIds = new Map()
  for (const name of [...new Set(occupations.map((o) => o.occupier))].sort()) occupierIds.set(name, slug(name))

  // colours: fixed ones first, then everyone else ranked by how much map they cover
  const colorConfig = readJson(new URL('./occupier-colors.json', import.meta.url).pathname)
  const byLower = new Map([...occupierIds.keys()].map((n) => [n.toLowerCase(), n]))
  const fixedColors = new Map()
  for (const [name, hex] of Object.entries(colorConfig.colors)) {
    const real = byLower.get(name.toLowerCase())
    if (real) fixedColors.set(real, hex)
    else console.warn(`occupier-colors.json: no occupier named "${name}"`)
  }
  const spanCount = new Map()
  for (const o of occupations) spanCount.set(o.occupier, (spanCount.get(o.occupier) ?? 0) + 1)
  const ranked = [...occupierIds.keys()].sort((a, b) => spanCount.get(b) - spanCount.get(a) || a.localeCompare(b))
  const colors = pickColors(ranked, fixedColors)
  for (const [name, target] of Object.entries(colorConfig.sameAs)) {
    const from = byLower.get(name.toLowerCase())
    const to = byLower.get(target.toLowerCase())
    if (from && to) colors.set(from, colors.get(to))
    else console.warn(`occupier-colors.json: sameAs ${name} -> ${target} not found`)
  }

  fs.mkdirSync(OUT, { recursive: true })
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE)
  const db = new Database(DB_FILE)
  db.exec(fs.readFileSync(path.join(ROOT, 'data/schema.sql'), 'utf8'))

  const admin0 = readJson(path.join(RAW, 'natural-earth/ne_10m_admin_0_countries.geojson'))
  const continentByCountry = new Map(admin0.features.map((f) => [f.properties.ADMIN, f.properties.CONTINENT]))
  const insertProvince = db.prepare(
    `INSERT INTO province (id, city_name, city_lat, city_lon, city_wikidata_id, city_source, seed_lat, seed_lon, area_km2, country, continent, region)
     VALUES (@id, @cityName, @cityLat, @cityLon, @cityQid, @citySource, @seedLat, @seedLon, @areaKm2, @country, @continent, @region)`,
  )
  const unplaced = new Set()
  const insertOccupier = db.prepare('INSERT INTO occupier (id, name, color, is_nation) VALUES (@id, @name, @color, @isNation)')
  const insertOccupation = db.prepare(
    'INSERT INTO occupation (province_id, occupier_id, start_year, end_year) VALUES (@province, @occupier, @start, @end)',
  )
  const insertRealmLink = db.prepare(
    'INSERT INTO realm_link (occupier_id, overlord_id, start_year, end_year, kind) VALUES (@occupierId, @overlordId, @start, @end, @kind)',
  )
  const realmLinks = buildRealmLinks(readJson(new URL('./overlords.json', import.meta.url).pathname), occupierIds)
  db.transaction(() => {
    for (const p of provinces) {
      insertProvince.run({
        id: p.id,
        cityName: p.city.name,
        cityLat: p.city.lat,
        cityLon: p.city.lon,
        cityQid: p.city.qid,
        citySource: p.city.source,
        seedLat: p.seed[1],
        seedLon: p.seed[0],
        areaKm2: p.areaKm2,
        country: p.country,
        continent: continentOf(p, continentByCountry) ?? (unplaced.add(p.country), 'Other'),
        region: p.region,
      })
    }
    for (const [name, id] of occupierIds) insertOccupier.run({ id, name, color: colors.get(name), isNation: isNation(name) ? 1 : 0 })
    for (const o of occupations) insertOccupation.run({ ...o, occupier: occupierIds.get(o.occupier) })
    for (const l of realmLinks) insertRealmLink.run(l)
  })()
  if (unplaced.size) console.warn(`no continent for: ${[...unplaced].join(', ')}`)
  db.close()

  const features = geometry.map((p) => ({
    type: 'Feature',
    properties: { id: p.id },
    geometry: { type: 'MultiPolygon', coordinates: p.geometry },
  }))
  fs.writeFileSync(path.join(OUT, 'provinces.geojson'), JSON.stringify({ type: 'FeatureCollection', features }))

  const nonCount = [...occupierIds.keys()].filter((n) => !isNation(n)).length
  console.log(
    `provinces: ${provinces.length}, occupiers: ${occupierIds.size} (${nonCount} not nations), occupations: ${occupations.length}; ` +
      `${realmLinks.length} realm links; db ${(fs.statSync(DB_FILE).size / 1024).toFixed(0)}KB, geojson ${(fs.statSync(path.join(OUT, 'provinces.geojson')).size / 1e6).toFixed(1)}MB`,
  )
}

main()
