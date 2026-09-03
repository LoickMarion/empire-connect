// Fetches the candidate city set from Wikidata, then narrows it down to
// TARGET_CITY_COUNT with three goals: (1) don't let a handful of countries
// with unusually granular Wikidata sovereignty-change data (e.g. Balkan
// micro-states, Israel) dominate the set, (2) prefer globally notable cities
// (via sitelinks count) over obscure ones when trimming, (3) always include
// an explicit seed list of historically important cities that the bulk query
// alone tends to miss (Persian/Iraqi cities, Sub-Saharan Africa, East/
// Southeast Asia, the pre-Columbian and colonial Americas).
//
// Output: data/raw/cities.json — array of raw Wikidata rows, one per city,
// including P1365/P1366 (replaces/replaced by) links used later to merge
// renamed-city item chains (e.g. Constantinople Q16869 -> Istanbul Q406) into
// a single logical city.
import fs from 'node:fs/promises'
import path from 'node:path'
import { sparql, qidFromUri, parseYear, parseCoord, sleep } from './lib/sparql.mjs'
import { fetchLabels, fetchSitelinkCounts, resolveLabelsToQids } from './lib/labels.mjs'

// Larger LIMITs on this query occasionally produce a truncated JSON response
// (observed consistently around ~1MB response body) rather than a clean
// error, so keep this comfortably under that size rather than trying to
// retry through it.
const POOL_LIMIT = Number(process.env.IMPORT_POOL_LIMIT || 3000)
const TARGET_CITY_COUNT = Number(process.env.IMPORT_CITY_LIMIT || 1500)
const PER_COUNTRY_CAP = Number(process.env.IMPORT_PER_COUNTRY_CAP || 30)
const OUT_DIR = new URL('../../data/raw/', import.meta.url)
const OUT_FILE = path.join(new URL(OUT_DIR).pathname, 'cities.json')
const SEED_FILE = new URL('./seed-cities.json', import.meta.url)

// Note: no SERVICE wikibase:label here — it times out when combined with this
// query's join shape at scale. Labels are fetched separately (see lib/labels.mjs).
//
// Also note: no ORDER BY — sorting forces the engine to fully materialize the
// (much larger, unfiltered-by-LIMIT) candidate set before applying LIMIT,
// which times out. Without ORDER BY, LIMIT lets the engine stop as soon as it
// has enough results, which is fast, at the cost of the result order being
// arbitrary (in practice: skewed toward whichever countries have the densest
// qualified-statement data on Wikidata) — that skew is corrected for below
// via the per-country cap rather than by trying to fix the query itself.
function poolQuery(limit) {
  // Matches cities with a qualified sovereignty-change statement via EITHER
  // P17 (country) or P131 (admin entity) — some regions (colonial holdings,
  // city-states) are only modeled via P131. Countries with very stable
  // borders (e.g. France, Japan proper) often have neither, which the seed
  // list compensates for separately.
  return `
    SELECT DISTINCT ?city ?coord ?inception ?dissolved ?replaces ?replacedBy ?country WHERE {
      {
        ?city p:P17 ?countryStmt .
        ?countryStmt pq:P580 ?ignoredStart .
      } UNION {
        ?city p:P131 ?adminStmt .
        ?adminStmt pq:P580 ?ignoredStart2 .
      }
      ?city wdt:P17 ?country .
      ?city wdt:P31 ?type .
      VALUES ?type { wd:Q515 wd:Q3957 wd:Q486972 wd:Q1637706 wd:Q1549591 }
      ?city wdt:P625 ?coord .
      OPTIONAL { ?city wdt:P571 ?inception }
      OPTIONAL { ?city wdt:P576 ?dissolved }
      OPTIONAL { ?city wdt:P1365 ?replaces }
      OPTIONAL { ?city wdt:P1366 ?replacedBy }
    }
    LIMIT ${limit}
  `
}

function seedDetailsQuery(qids) {
  const values = qids.map((q) => `wd:${q}`).join(' ')
  return `
    SELECT ?city ?coord ?inception ?dissolved ?replaces ?replacedBy ?country WHERE {
      VALUES ?city { ${values} }
      ?city wdt:P625 ?coord .
      OPTIONAL { ?city wdt:P571 ?inception }
      OPTIONAL { ?city wdt:P576 ?dissolved }
      OPTIONAL { ?city wdt:P1365 ?replaces }
      OPTIONAL { ?city wdt:P1366 ?replacedBy }
      OPTIONAL { ?city wdt:P17 ?country }
    }
  `
}

function rowToCity(row) {
  const coord = parseCoord(row.coord?.value)
  if (!coord) return null
  return {
    qid: qidFromUri(row.city.value),
    lat: coord.lat,
    lon: coord.lon,
    inceptionYear: parseYear(row.inception?.value),
    dissolvedYear: parseYear(row.dissolved?.value),
    replaces: qidFromUri(row.replaces?.value),
    replacedBy: qidFromUri(row.replacedBy?.value),
    country: qidFromUri(row.country?.value),
  }
}

async function main() {
  await fs.mkdir(new URL(OUT_DIR), { recursive: true })

  console.log(`fetching candidate pool (limit ${POOL_LIMIT})...`)
  const poolRows = await sparql(poolQuery(POOL_LIMIT))
  const pool = new Map()
  for (const row of poolRows) {
    const city = rowToCity(row)
    if (city) pool.set(city.qid, city)
  }
  console.log(`pool: ${poolRows.length} rows -> ${pool.size} distinct cities`)

  const seedLabels = JSON.parse(await fs.readFile(SEED_FILE, 'utf8'))
  console.log(`resolving ${seedLabels.length} seed labels...`)
  const seedQids = await resolveLabelsToQids(seedLabels)
  const unresolvedSeeds = seedLabels.filter((l) => !seedQids.has(l))
  if (unresolvedSeeds.length > 0) {
    console.warn('could not resolve seed labels:', unresolvedSeeds.join(', '))
  }

  const seedQidList = [...seedQids.values()]
  const seedCities = new Map()
  for (let i = 0; i < seedQidList.length; i += 60) {
    const batch = seedQidList.slice(i, i + 60)
    const seedRows = await sparql(seedDetailsQuery(batch))
    for (const row of seedRows) {
      const city = rowToCity(row)
      if (city) seedCities.set(city.qid, city)
    }
    await sleep(300)
  }
  const missingSeedCoords = seedQidList.filter((q) => !seedCities.has(q))
  if (missingSeedCoords.length > 0) {
    console.warn('seed cities with no usable coordinate, dropped:', missingSeedCoords.join(', '))
  }
  console.log(`seeds: ${seedCities.size} resolved with coordinates`)

  const sitelinkCounts = await fetchSitelinkCounts([...pool.keys(), ...seedCities.keys()])

  // Cap how many cities from the pool any single "current country" can
  // contribute, keeping the most notable (highest sitelinks) first. Seed
  // cities are exempt from this cap entirely.
  const byCountry = new Map()
  for (const city of pool.values()) {
    if (seedCities.has(city.qid)) continue
    const key = city.country ?? 'unknown'
    if (!byCountry.has(key)) byCountry.set(key, [])
    byCountry.get(key).push(city)
  }

  const cappedPool = []
  for (const cities of byCountry.values()) {
    cities.sort((a, b) => (sitelinkCounts.get(b.qid) ?? 0) - (sitelinkCounts.get(a.qid) ?? 0))
    cappedPool.push(...cities.slice(0, PER_COUNTRY_CAP))
  }
  console.log(`pool after per-country cap (${PER_COUNTRY_CAP}/country): ${cappedPool.length}`)

  // Trim the capped pool (not the seeds) down to fit the overall target,
  // preferring the most notable cities.
  const budget = Math.max(TARGET_CITY_COUNT - seedCities.size, 0)
  cappedPool.sort((a, b) => (sitelinkCounts.get(b.qid) ?? 0) - (sitelinkCounts.get(a.qid) ?? 0))
  const finalPool = cappedPool.slice(0, budget)

  const finalCities = [...seedCities.values(), ...finalPool]
  let result = finalCities.map((c) => ({ ...c, sitelinks: sitelinkCounts.get(c.qid) ?? 0 }))

  console.log(`fetching labels for ${result.length} cities...`)
  const labels = await fetchLabels(result.map((c) => c.qid))
  result = result.map((c) => ({ ...c, label: labels.get(c.qid) ?? c.qid }))

  await fs.writeFile(OUT_FILE, JSON.stringify(result, null, 2))
  console.log(`wrote ${result.length} cities to ${OUT_FILE} (${seedCities.size} seeds + ${finalPool.length} from pool)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
