// For each city fetched in step 01, fetches its full P17 (country) statement
// history with P580/P582 (start/end time) qualifiers. Each qualified statement
// becomes one `holding` row (empire + city + start/end year).
//
// Falls back to P131 (located in the administrative territorial entity) for
// cities that have no qualified P17 statements at all, since city-states and
// some periods are only modeled that way on Wikidata.
//
// Output: data/raw/holdings.json (raw {cityQid, empireQid, empireLabel, start, end}[])
//         data/raw/empires.json  (deduped {qid, label}[])
import fs from 'node:fs/promises'
import path from 'node:path'
import { sparql, qidFromUri, parseYear, sleep } from './lib/sparql.mjs'
import { fetchLabels } from './lib/labels.mjs'

const BATCH_SIZE = 40
const RAW_DIR = new URL('../../data/raw/', import.meta.url)
const CITIES_FILE = path.join(new URL(RAW_DIR).pathname, 'cities.json')
const HOLDINGS_FILE = path.join(new URL(RAW_DIR).pathname, 'holdings.json')
const EMPIRES_FILE = path.join(new URL(RAW_DIR).pathname, 'empires.json')

function holdingsQuery(qids, property, startProp, endProp) {
  const values = qids.map((q) => `wd:${q}`).join(' ')
  // No SERVICE wikibase:label here (times out at scale) — empire labels are
  // fetched separately in a batch pass below, same as city labels in step 01.
  return `
    SELECT ?city ?empire ?start ?end WHERE {
      VALUES ?city { ${values} }
      ?city p:${property} ?stmt .
      ?stmt ps:${property} ?empire .
      OPTIONAL { ?stmt pq:${startProp} ?start }
      OPTIONAL { ?stmt pq:${endProp} ?end }
    }
  `
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function fetchForProperty(qids, property) {
  const rows = []
  for (const batch of chunk(qids, BATCH_SIZE)) {
    const result = await sparql(holdingsQuery(batch, property, 'P580', 'P582'))
    rows.push(...result)
    await sleep(400)
  }
  return rows
}

async function main() {
  const cities = JSON.parse(await fs.readFile(CITIES_FILE, 'utf8'))
  const qids = cities.map((c) => c.qid)

  console.log(`fetching P17 (country) holdings for ${qids.length} cities...`)
  const p17rows = await fetchForProperty(qids, 'P17')

  const citiesWithP17 = new Set(p17rows.map((r) => qidFromUri(r.city.value)))
  const missing = qids.filter((q) => !citiesWithP17.has(q))

  let p131rows = []
  if (missing.length > 0) {
    console.log(`fetching P131 (admin entity) fallback holdings for ${missing.length} cities without P17 history...`)
    p131rows = await fetchForProperty(missing, 'P131')
  }

  const allRows = [...p17rows, ...p131rows]
  const holdings = []
  const empireQids = new Set()

  for (const row of allRows) {
    const start = parseYear(row.start?.value)
    const end = parseYear(row.end?.value)
    if (start == null || end == null) continue // unqualified statements aren't usable as a time range
    const empireQid = qidFromUri(row.empire.value)
    empireQids.add(empireQid)
    holdings.push({
      cityQid: qidFromUri(row.city.value),
      empireQid,
      start,
      end,
      synthetic: false,
    })
  }

  // A handful of otherwise well-known cities (e.g. Paris) have no qualified
  // sovereignty-change statement on Wikidata at all — their country basically
  // never changed, so nobody bothered to date-qualify it. Without at least
  // one holding they'd be unreachable/unconnectable in the game, so synthesize
  // one from their current (unqualified) country. This is NOT a real
  // historical claim (it does not mean that country actually existed/ruled
  // there since antiquity) — it's marked `synthetic` so map/history views
  // that render actual historical territory (Paint mode) can exclude it,
  // while the connect-the-cities game logic can still use it for reachability.
  const CURRENT_YEAR = new Date().getFullYear()
  const citiesWithHoldings = new Set(holdings.map((h) => h.cityQid))
  for (const city of cities) {
    if (citiesWithHoldings.has(city.qid) || !city.country) continue
    empireQids.add(city.country)
    holdings.push({
      cityQid: city.qid,
      empireQid: city.country,
      start: city.inceptionYear ?? -3000,
      end: CURRENT_YEAR,
      synthetic: true,
    })
  }

  console.log(`fetching labels for ${empireQids.size} empires...`)
  const labels = await fetchLabels([...empireQids])
  const empires = [...empireQids].map((qid) => ({ qid, label: labels.get(qid) ?? qid }))

  await fs.mkdir(new URL(RAW_DIR), { recursive: true })
  await fs.writeFile(HOLDINGS_FILE, JSON.stringify(holdings, null, 2))
  await fs.writeFile(EMPIRES_FILE, JSON.stringify(empires, null, 2))
  console.log(`wrote ${holdings.length} holdings across ${empires.length} empires`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
