// Builds public/data/empire-connect.sqlite from the raw Wikidata + border data
// fetched by steps 01-04. Always rebuilds from scratch (cheap, no incremental
// merge logic needed).
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { makeSlugger, colorForLabel } from './lib/slugify.mjs'

const ROOT = new URL('../../', import.meta.url).pathname
const RAW_DIR = path.join(ROOT, 'data/raw')
const SCHEMA_FILE = path.join(ROOT, 'data/schema.sql')
const DB_FILE = path.join(ROOT, 'public/data/empire-connect.sqlite')
const BORDERS_DIR = path.join(ROOT, 'public/data/borders')
const BORDER_EMPIRE_MAP_FILE = path.join(ROOT, 'scripts/import/border-empire-map.json')
const UNKNOWN_START_YEAR = -3000

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

// Rough distance in km between two lat/lon points (haversine).
const EARTH_RADIUS_KM = 6371
function distanceKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}
// P1365/P1366 (replaces/replaced by) on Wikidata isn't always a same-place
// rename — sometimes it links administratively-reorganized but physically
// distinct settlements (e.g. a nearby municipality absorbed/split off).
// Only treat it as a rename (and merge into one logical city) when the two
// items' coordinates are close enough to plausibly be the same place.
const SAME_PLACE_MAX_KM = 15

// --- merge-chain: collapse renamed-city Wikidata item chains into one logical city ---
function buildCityClusters(cities) {
  const byQid = new Map(cities.map((c) => [c.qid, c]))
  const parent = new Map(cities.map((c) => [c.qid, c.qid]))

  function find(qid) {
    while (parent.get(qid) !== qid) {
      parent.set(qid, parent.get(parent.get(qid)))
      qid = parent.get(qid)
    }
    return qid
  }
  function union(a, b) {
    if (!byQid.has(a) || !byQid.has(b)) return
    if (distanceKm(byQid.get(a), byQid.get(b)) > SAME_PLACE_MAX_KM) return
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  for (const c of cities) {
    if (c.replaces) union(c.qid, c.replaces)
    if (c.replacedBy) union(c.qid, c.replacedBy)
  }

  const clusters = new Map() // root -> [cities]
  for (const c of cities) {
    const root = find(c.qid)
    if (!clusters.has(root)) clusters.set(root, [])
    clusters.get(root).push(c)
  }
  return [...clusters.values()]
}

function earliestHoldingStart(qid, holdingsByCity) {
  const hs = holdingsByCity.get(qid)
  if (!hs || hs.length === 0) return null
  return Math.min(...hs.map((h) => h.start))
}

function main() {
  const cities = readJson(path.join(RAW_DIR, 'cities.json'))
  const holdings = readJson(path.join(RAW_DIR, 'holdings.json'))
  const empires = readJson(path.join(RAW_DIR, 'empires.json'))

  const holdingsByCity = new Map()
  for (const h of holdings) {
    if (!holdingsByCity.has(h.cityQid)) holdingsByCity.set(h.cityQid, [])
    holdingsByCity.get(h.cityQid).push(h)
  }

  const clusters = buildCityClusters(cities)

  const citySlug = makeSlugger()
  const empireSlug = makeSlugger()

  const cityRows = []
  const cityNameRows = []
  const qidToCityId = new Map()

  for (const cluster of clusters) {
    // Order chain members oldest -> newest using whichever signal is available.
    const ordered = [...cluster].sort((a, b) => {
      const ay = a.inceptionYear ?? earliestHoldingStart(a.qid, holdingsByCity) ?? 0
      const by = b.inceptionYear ?? earliestHoldingStart(b.qid, holdingsByCity) ?? 0
      return ay - by
    })

    const mostRecent = ordered[ordered.length - 1]
    const id = citySlug(mostRecent.label)
    for (const member of cluster) qidToCityId.set(member.qid, id)

    const namesBefore = cityNameRows.length
    for (let i = 0; i < ordered.length; i += 1) {
      const member = ordered[i]
      const next = ordered[i + 1]
      const start = member.inceptionYear ?? earliestHoldingStart(member.qid, holdingsByCity)
      if (start == null) continue // no usable start year for this name, skip it
      const end = next ? (next.inceptionYear ?? start) : (member.dissolvedYear ?? null)
      cityNameRows.push({ cityId: id, name: member.label, start, end })
    }
    // Neither Wikidata's inception date nor any qualified holding gave us a
    // usable start year for any member of this cluster (a handful of
    // otherwise well-known cities, e.g. Isfahan/Kufa, lack both) — fall back
    // to a sentinel "ancient/unknown" start so the city still has a display
    // name rather than falling back to its internal id slug in the UI.
    if (cityNameRows.length === namesBefore) {
      cityNameRows.push({ cityId: id, name: mostRecent.label, start: UNKNOWN_START_YEAR, end: null })
    }

    const founded = ordered[0].inceptionYear ?? earliestHoldingStart(ordered[0].qid, holdingsByCity)
    const dissolved = mostRecent.dissolvedYear ?? null

    cityRows.push({
      id,
      lat: mostRecent.lat,
      lon: mostRecent.lon,
      founded,
      dissolved,
      wikidataId: mostRecent.qid,
    })
  }

  const empireRows = empires.map((e) => ({
    id: empireSlug(e.label),
    name: e.label,
    color: colorForLabel(e.label),
    wikidataId: e.qid,
  }))
  const empireQidToId = new Map(empireRows.map((e) => [e.wikidataId, e.id]))

  const holdingRows = holdings
    .map((h) => ({
      empireId: empireQidToId.get(h.empireQid),
      cityId: qidToCityId.get(h.cityQid),
      start: h.start,
      end: h.end,
      synthetic: h.synthetic ? 1 : 0,
    }))
    .filter((h) => h.empireId && h.cityId && h.start <= h.end)

  // --- borders ---
  const borderIndexPath = path.join(BORDERS_DIR, 'index.json')
  let borderIndex = []
  if (fs.existsSync(borderIndexPath)) {
    borderIndex = readJson(borderIndexPath)
  } else {
    console.warn('no public/data/borders/index.json found — run 03/04 first. Skipping border data.')
  }

  const empireLabelLower = new Map(empireRows.map((e) => [e.name.toLowerCase(), e.id]))
  const handMap = fs.existsSync(BORDER_EMPIRE_MAP_FILE) ? readJson(BORDER_EMPIRE_MAP_FILE) : {}

  const borderEraRows = []
  const borderEmpireMapRows = []
  const unmatchedNames = new Set()
  const autoMatched = {}

  for (const { file, eraYear } of borderIndex) {
    const filePath = path.join(BORDERS_DIR, file)
    if (!fs.existsSync(filePath)) continue
    const geojson = readJson(filePath)
    const names = new Set(geojson.features.map((f) => f.properties?.NAME).filter(Boolean))
    borderEraRows.push({ eraYear, file: `borders/${file}` })

    for (const name of names) {
      const empireId = handMap[name] ?? empireLabelLower.get(name.toLowerCase())
      if (empireId && empireRows.some((e) => e.id === empireId)) {
        borderEmpireMapRows.push({ eraYear, empireId, featureName: name })
        autoMatched[name] = empireId
      } else {
        unmatchedNames.add(name)
      }
    }
  }

  // Persist/extend the hand-curated mapping file with newly auto-matched names,
  // so it can be extended by hand later for the names that stay unmatched.
  const mergedMap = { ...autoMatched, ...handMap }
  const sortedMap = Object.fromEntries(Object.keys(mergedMap).sort().map((k) => [k, mergedMap[k]]))
  fs.writeFileSync(BORDER_EMPIRE_MAP_FILE, JSON.stringify(sortedMap, null, 2))
  console.log(`border features: ${borderEmpireMapRows.length} matched to empires, ${unmatchedNames.size} unmatched`)
  if (unmatchedNames.size > 0) {
    console.log('sample unmatched feature names:', [...unmatchedNames].slice(0, 15).join(', '))
  }

  // --- write sqlite ---
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE)
  const db = new Database(DB_FILE)
  db.exec(fs.readFileSync(SCHEMA_FILE, 'utf8'))

  const insertCity = db.prepare(
    'INSERT INTO city (id, lat, lon, founded_year, dissolved_year, wikidata_id) VALUES (@id, @lat, @lon, @founded, @dissolved, @wikidataId)',
  )
  const insertCityName = db.prepare(
    'INSERT OR IGNORE INTO city_name (city_id, name, start_year, end_year) VALUES (@cityId, @name, @start, @end)',
  )
  const insertEmpire = db.prepare('INSERT INTO empire (id, name, color, wikidata_id) VALUES (@id, @name, @color, @wikidataId)')
  const insertHolding = db.prepare(
    'INSERT INTO holding (empire_id, city_id, start_year, end_year, synthetic) VALUES (@empireId, @cityId, @start, @end, @synthetic)',
  )
  const insertBorderEra = db.prepare('INSERT INTO border_era (era_year, file) VALUES (@eraYear, @file)')
  const insertBorderEmpireMap = db.prepare(
    'INSERT OR IGNORE INTO border_empire_map (border_era_id, empire_id, feature_name) VALUES (@borderEraId, @empireId, @featureName)',
  )

  const eraIdByYear = new Map()
  db.transaction(() => {
    for (const c of cityRows) insertCity.run(c)
    for (const n of cityNameRows) insertCityName.run(n)
    for (const e of empireRows) insertEmpire.run(e)
    for (const h of holdingRows) insertHolding.run(h)
    for (const b of borderEraRows) {
      const info = insertBorderEra.run(b)
      eraIdByYear.set(b.eraYear, info.lastInsertRowid)
    }
    for (const m of borderEmpireMapRows) {
      const borderEraId = eraIdByYear.get(m.eraYear)
      if (borderEraId) insertBorderEmpireMap.run({ borderEraId, empireId: m.empireId, featureName: m.featureName })
    }
  })()

  const actualNameCount = db.prepare('SELECT count(*) AS n FROM city_name').get().n
  if (actualNameCount < cityNameRows.length) {
    console.warn(`skipped ${cityNameRows.length - actualNameCount} duplicate (city, start_year) name rows`)
  }

  db.close()

  const dbStat = fs.statSync(DB_FILE)
  console.log(
    `cities: ${cityRows.length}, names: ${actualNameCount}, empires: ${empireRows.length}, holdings: ${holdingRows.length}, border eras: ${borderEraRows.length}`,
  )
  console.log(`wrote ${DB_FILE} (${(dbStat.size / 1024).toFixed(0)}KB)`)
}

main()
