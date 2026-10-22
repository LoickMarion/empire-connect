// For each province: pick its one city, then derive an occupation record (which
// country/tribe/empire held it during which years) by sampling the historical-basemaps
// border snapshots at the province's points. Writes data/raw/province-data.json.
import fs from 'node:fs/promises'
import path from 'node:path'
import { sparql, qidFromUri, parseCoord } from '../import/lib/sparql.mjs'
import { buildIndex, containing, flattenPolygons, mercY, ringBBox } from './lib/geo.mjs'

const RAW = new URL('../../data/raw/', import.meta.url).pathname
const NE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson'

// Divisions whose city is hand-listed (listed-cities.json, county-groups.json): the generic
// populated-places list is too thin to give each small county or province a sensible city.
const LISTED_COUNTRIES = new Set(['England', 'Scotland', 'Wales', 'Northern Ireland', 'Ireland', 'Netherlands', 'Belgium', 'Germany', 'France'])

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))

async function populatedPlaces() {
  const dest = path.join(RAW, 'natural-earth', 'ne_10m_populated_places_simple.geojson')
  try {
    return await readJson(dest)
  } catch {
    console.log('downloading ne_10m_populated_places_simple.geojson...')
    const text = await (await fetch(`${NE_URL}/ne_10m_populated_places_simple.geojson`)).text()
    await fs.writeFile(dest, text)
    return JSON.parse(text)
  }
}

function yearFromFile(file) {
  const m = /^world_(bc)?(\d+)\.geojson$/.exec(file)
  return m ? (m[1] ? -1 : 1) * parseInt(m[2], 10) : null
}

// Wikidata capitals (P36) for administrative divisions, cached in data/raw/admin1-capitals.json.
async function capitalsOf(qids) {
  const file = path.join(RAW, 'admin1-capitals.json')
  const cache = await readJson(file).catch(() => ({}))
  const missing = [...new Set(qids)].filter((q) => !(q in cache))
  for (let i = 0; i < missing.length; i += 60) {
    const batch = missing.slice(i, i + 60)
    const rows = await sparql(`SELECT ?r ?cap ?capLabel ?coord WHERE {
      VALUES ?r { ${batch.map((q) => `wd:${q}`).join(' ')} }
      ?r wdt:P36 ?cap . ?cap wdt:P625 ?coord .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en,fr,es,it,pt,de". }
    }`)
    for (const q of batch) cache[q] = null
    for (const r of rows) {
      const { lat, lon } = parseCoord(r.coord.value)
      cache[qidFromUri(r.r.value)] ??= { name: r.capLabel.value, lat, lon, qid: qidFromUri(r.cap.value) }
    }
  }
  if (missing.length) await fs.writeFile(file, JSON.stringify(cache, null, 1))
  return new Map(Object.entries(cache).filter(([, v]) => v))
}

// The border snapshots jump from 1200 straight to 1279, so the Mongol conquests would appear all at
// once. For provinces held by a Mongol successor khanate in 1279 (and by another state in 1200),
// insert a 'Mongol Empire' span from the year the province was conquered (mongol-conquests.json).
function applyMongolConquests(occupations, provinces, config) {
  const successors = new Set(config.successors)
  const byProvince = new Map()
  for (const o of occupations) {
    if (!byProvince.has(o.province)) byProvince.set(o.province, [])
    byProvince.get(o.province).push(o)
  }
  const histogram = {}
  for (const p of provinces) {
    const spans = byProvince.get(p.id) ?? []
    const at = (year) => spans.find((s) => s.start <= year && (s.end ?? Infinity) >= year)
    const before = at(1200)
    const after = at(1279)
    if (!after || !successors.has(after.occupier)) continue
    if (before?.occupier === 'Mongol Empire') continue // already Mongol in 1200
    const [lon, lat] = p.seed
    const predecessor = before ? before.occupier : '(none)'
    const rule = config.rules.find(
      (r) => r.pred.includes(predecessor) && (!r.box || (lon >= r.box[0] && lon <= r.box[1] && lat >= r.box[2] && lat <= r.box[3])),
    )
    const year = rule ? rule.year : config.defaultYear
    if (year <= 1200 || year >= 1279) continue
    if (before) before.end = Math.min(before.end ?? Infinity, year - 1)
    const added = { province: p.id, occupier: 'Mongol Empire', start: year, end: 1278 }
    occupations.push(added)
    histogram[year] = (histogram[year] ?? 0) + 1
  }
  const total = Object.values(histogram).reduce((a, b) => a + b, 0)
  console.log(`Mongol conquests dated for ${total} provinces: ` + Object.entries(histogram).sort((a, b) => a[0] - b[0]).map(([y, n]) => `${y}:${n}`).join(' '))
}

// Dated timelines for periods the border snapshots skip over (the Napoleonic wars, the Second World
// War). Each group in the config names provinces (Country/Region keys and/or `select` rules: country
// plus optional regions / except / polygon / notPolygon / box on the province's seed) and a timeline of
// [year, occupier]: the occupier holds from that year until the next entry; the last entry runs to
// `until`. "@YYYY" means 'whoever held the province in the YYYY snapshot' (the restoration) and
// null means 'leave the existing record alone from here'. The span from the first entry's year to
// `until` is replaced.
const inPolygon = ([x, y], poly) => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const selects = (p, sel) =>
  p.country === sel.country &&
  (!sel.regions || sel.regions.includes(p.region)) &&
  (!sel.except || !sel.except.includes(p.region)) &&
  (!sel.polygon || inPolygon(p.seed, sel.polygon)) &&
  (!sel.notPolygon || !inPolygon(p.seed, sel.notPolygon)) &&
  (!sel.box || (p.seed[0] >= sel.box[0] && p.seed[0] <= sel.box[1] && p.seed[1] >= sel.box[2] && p.seed[1] <= sel.box[3]))

function applyTimelineGroups(occupations, provinces, config, label) {
  const byKey = new Map(provinces.map((p) => [`${p.country}/${p.region}`, p]))
  const missing = new Set()
  let changed = 0
  for (const group of config.groups) {
    const chosen = new Map()
    for (const key of group.provinces ?? []) {
      const p = byKey.get(key)
      if (p) chosen.set(p.id, p)
      else missing.add(key)
    }
    for (const sel of group.select ?? []) {
      let any = false
      for (const p of provinces) {
        if (selects(p, sel)) {
          chosen.set(p.id, p)
          any = true
        }
      }
      if (!any) missing.add(`${sel.country} ${JSON.stringify(sel.regions ?? sel.polygon ?? '').slice(0, 40)}`)
    }
    const until = group.until === 'present' ? Infinity : (group.until ?? config.until ?? 1814) // 'present': an open-ended last span
    for (const p of chosen.values()) {
      const id = p.id
      if (group.relabel) {
        // rename a people/culture label without changing its dates
        const from = [].concat(group.relabel.from)
        for (const o of occupations) if (o.province === id && from.includes(o.occupier)) o.occupier = group.relabel.to
        changed += 1
        continue
      }
      const spans = occupations.filter((o) => o.province === id)
      const at = (year) => spans.find((s) => s.start <= year && (s.end ?? Infinity) >= year)?.occupier
      if (group.when && at(group.when.year) !== group.when.occupier) continue // only where that occupier held it
      const segments = []
      group.timeline.forEach(([from, value], i) => {
        const to = i + 1 < group.timeline.length ? group.timeline[i + 1][0] - 1 : until
        const occupier = typeof value === 'string' && value.startsWith('@') ? at(parseInt(value.slice(1), 10)) : value
        if (occupier && from <= to) segments.push({ from, to, occupier })
      })
      if (!segments.length) continue
      const start = segments[0].from
      const windowEnd = segments[segments.length - 1].to
      const kept = []
      for (const span of spans) {
        const end = span.end ?? Infinity
        if (end < start || span.start > windowEnd) {
          kept.push(span)
          continue
        }
        if (span.start < start) kept.push({ ...span, end: start - 1 })
        if (end > windowEnd) kept.push({ ...span, start: windowEnd + 1 })
      }
      for (const seg of segments) kept.push({ province: id, occupier: seg.occupier, start: seg.from, end: Number.isFinite(seg.to) ? seg.to : null })
      for (let i = occupations.length - 1; i >= 0; i -= 1) if (occupations[i].province === id) occupations.splice(i, 1)
      occupations.push(...kept)
      changed += 1
    }
  }
  console.log(`${label} timelines applied (${changed} province updates)` + (missing.size ? `; not found: ${[...missing].join(', ')}` : ''))
}


// The snapshots stop naming the peoples of tropical Africa after 1529 and leave those provinces blank
// until the colonial era. Where a people/culture label is followed by a gap, it carries on through it.
function carryPeoplesThroughGaps(occupations, provinces, nonNations) {
  const patterns = nonNations.patterns.map((p) => new RegExp(p, 'i'))
  const names = new Set(nonNations.names.map((n) => n.toLowerCase()))
  const isPeople = (name) => names.has(name.toLowerCase()) || patterns.some((r) => r.test(name))
  let carried = 0
  for (const p of provinces) {
    const [lon, lat] = p.seed
    if (lon < -20 || lon > 52 || lat < -36 || lat > 14) continue // tropical and southern Africa
    const spans = occupations.filter((o) => o.province === p.id).sort((a, b) => a.start - b.start)
    for (let i = 0; i + 1 < spans.length; i += 1) {
      const end = spans[i].end ?? Infinity
      if (end >= spans[i + 1].start - 1 || !isPeople(spans[i].occupier) || end < 800) continue
      spans[i].end = spans[i + 1].start - 1
      carried += 1
    }
  }
  console.log(`people labels carried through ${carried} gaps`)
}

// The source draws the Polish-Lithuanian Commonwealth from 1400 (the personal union), but the
// Commonwealth only formed at the Union of Lublin in 1569. Before then each of its spans is whichever
// state held the province: Poland (the Crown), Lithuania (the Grand Duchy), the Livonian Order (to 1560)
// or Prussia. Spans from 1569 stay Poland-Lithuania.
const COMMONWEALTH = 1569
function splitCommonwealth(occupations, provinces, aliases) {
  const byId = new Map(provinces.map((p) => [p.id, p]))
  const crownUkraine = ['Galicia', 'Ternopil', 'Ivano-Frankivsk']
  // [from, to, occupier] pieces of a pre-1569 span, in order, for one province
  const holders = (p) => {
    if (p.country === 'Latvia' || p.country === 'Estonia') return [[-Infinity, 1560, 'Teutonic Knights'], [1561, 1568, 'Lithuania']]
    if (p.country === 'Poland') {
      if (p.region === 'Podlasie') return [[-Infinity, 1568, 'Lithuania']]
      if (p.region === 'Masuria') return [[-Infinity, 1525, 'Teutonic Knights'], [1526, 1568, 'Prussia']]
      if (p.region === 'Lithuania Minor') return [[-Infinity, 1568, 'Prussia']]
      return [[-Infinity, 1568, 'Poland']]
    }
    if (p.country === 'Ukraine' && crownUkraine.includes(p.region)) return [[-Infinity, 1568, 'Poland']]
    if (p.country === 'Ukraine' && ['Podolia', 'Khmelnytskyi'].includes(p.region)) return [[-Infinity, 1433, 'Lithuania'], [1434, 1568, 'Poland']]
    return [[-Infinity, 1568, 'Lithuania']]
  }
  let split = 0
  for (const span of [...occupations]) {
    const end = span.end ?? Infinity
    if ((aliases[span.occupier] ?? span.occupier) !== 'Poland-Lithuania' || span.start >= COMMONWEALTH) continue
    const p = byId.get(span.province)
    if (!p) continue
    occupations.splice(occupations.indexOf(span), 1)
    for (const [from, to, occupier] of holders(p)) {
      const start = Math.max(from, span.start)
      const last = Math.min(to, end)
      if (start <= last) occupations.push({ province: span.province, occupier, start, end: last })
    }
    if (end >= COMMONWEALTH) occupations.push({ ...span, start: COMMONWEALTH })
    split += 1
  }
  console.log(`Poland-Lithuania before 1569 split into its states for ${split} spans`)
}

// A province whose own sample points miss every border snapshot (Ceuta is 42 km2) has no record at
// all; it copies the one of the province it was split from, and a timeline then dates what differs.
function inheritRecords(occupations, provinces, inherit) {
  const byKey = new Map(provinces.map((p) => [`${p.country}/${p.region}`, p]))
  for (const { province, from } of inherit) {
    const to = byKey.get(province)
    const source = byKey.get(from)
    if (!to || !source) {
      console.warn(`enclaves.json: no province ${!to ? province : from}`)
      continue
    }
    if (occupations.some((o) => o.province === to.id)) continue
    for (const o of occupations.filter((o) => o.province === source.id)) occupations.push({ ...o, province: to.id })
  }
}

// Spans that touch, with the same occupier, are one span.
function mergeTouching(occupations) {
  occupations.sort((a, b) => (a.province < b.province ? -1 : a.province > b.province ? 1 : a.start - b.start))
  for (let i = occupations.length - 1; i > 0; i -= 1) {
    const prev = occupations[i - 1]
    const o = occupations[i]
    if (prev.province === o.province && prev.occupier === o.occupier && prev.end !== null && prev.end + 1 >= o.start) {
      prev.end = o.end
      occupations.splice(i, 1)
    }
  }
}

// Spain only existed from 1530; what the source labels Spain before that (the Canary Islands, the
// North African presidios) was held by Castile.
function spainFromCastile(occupations) {
  let moved = 0
  for (const o of [...occupations]) {
    if (o.occupier !== 'Spain' || o.start >= 1530) continue
    moved += 1
    if (o.end === null || o.end >= 1530) {
      occupations.push({ ...o, start: 1530 })
      o.end = 1529
    }
    o.occupier = 'Castile'
  }
  console.log(`${moved} Spain spans before 1530 are Castile`)
}

// The source leaves Brazil to its peoples or to nobody until the Viceroyalty of Brazil (1715 on the
// coast, 1783 inland). Portugal claimed the coast from 1500, the middle of the country from 1650
// and the Amazon from the Treaty of Madrid (1750). Wherever a province holds only a people or a gap
// before the Viceroyalty, 'Portuguese Brazil' fills it; nations already recorded (Dutch Brazil,
// the Viceroyalty of Peru) stay.
function claimBrazil(occupations, provinces, nonNations) {
  const patterns = nonNations.patterns.map((p) => new RegExp(p, 'i'))
  const names = new Set(nonNations.names.map((n) => n.toLowerCase()))
  const isPeople = (name) => names.has(name.toLowerCase()) || patterns.some((r) => r.test(name))
  let filled = 0
  for (const p of provinces.filter((p) => p.country === 'Brazil')) {
    const from = p.seed[0] >= -48 ? 1500 : p.seed[0] >= -56 ? 1650 : 1750
    const to = 1782
    const mine = occupations.filter((o) => o.province === p.id)
    // drop the peoples' spans in the window (trimming those that straddle it)
    for (const o of mine) {
      const end = o.end ?? Infinity
      if (!isPeople(o.occupier) || end < from || o.start > to) continue
      if (o.start < from) {
        if (end > to) occupations.push({ ...o, start: to + 1 })
        o.end = from - 1
      } else if (end > to) o.start = to + 1
      else o.occupier = null
    }
    for (let i = occupations.length - 1; i >= 0; i -= 1) if (occupations[i].occupier === null) occupations.splice(i, 1)
    // fill what no nation covers
    const nations = occupations.filter((o) => o.province === p.id && o.start <= to && (o.end ?? Infinity) >= from).sort((a, b) => a.start - b.start)
    let cursor = from
    const gaps = []
    for (const o of nations) {
      if (o.start > cursor) gaps.push([cursor, o.start - 1])
      cursor = Math.max(cursor, (o.end ?? Infinity) + 1)
    }
    if (cursor <= to) gaps.push([cursor, to])
    for (const [start, end] of gaps) occupations.push({ province: p.id, occupier: 'Portuguese Brazil', start, end })
    filled += gaps.length
  }
  console.log(`Portuguese Brazil fills ${filled} gaps`)
}

// Hand corrections (occupation-overrides.json): for one province, replace whatever overlapped
// [from, to] with the given occupier, trimming spans that straddle the edges.
function applyOverrides(occupations, provinces, overrides) {
  const byKey = new Map()
  for (const p of provinces) {
    const key = `${p.country}/${p.region}`
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(p)
  }
  for (const o of overrides) {
    // a region split into several provinces (Québec, Texas...) can be narrowed with "city"
    const matches = (byKey.get(o.province) ?? []).filter((p) => !o.city || p.city.name === o.city)
    if (!matches.length) {
      console.warn(`occupation-overrides.json: no province ${o.province}${o.city ? ` (${o.city})` : ''}`)
      continue
    }
    const to = o.to >= 2025 ? Infinity : o.to // 2025 or later means 'to the present'
    for (const { id } of matches) {
      const kept = []
      for (const span of occupations.filter((s) => s.province === id)) {
        const end = span.end ?? Infinity
        if (end < o.from || span.start > to) {
          kept.push(span)
          continue
        }
        if (span.start < o.from) kept.push({ ...span, end: o.from - 1 })
        if (end > to) kept.push({ ...span, start: to + 1 })
      }
      kept.push({ province: id, occupier: o.occupier, start: o.from, end: to === Infinity ? null : to })
      for (let i = occupations.length - 1; i >= 0; i -= 1) if (occupations[i].province === id) occupations.splice(i, 1)
      occupations.push(...kept)
    }
  }
}

// Replaces each 'Holy Roman Empire' span with the constituent state / free city that held that
// province (hre-constituents.json), applies occupier-aliases.json, and merges spans that end up
// naming the same occupier back to back.
function splitHolyRomanEmpire(occupations, provinces, { mapping }, aliases, repairs) {
  const byId = new Map(provinces.map((p) => [p.id, p]))
  const result = []
  const unmapped = new Set()
  const names = new Set()
  for (const o of occupations) {
    if (o.occupier !== 'Holy Roman Empire') {
      result.push(o)
      continue
    }
    const p = byId.get(o.province)
    const entry = mapping[`${p.country}/${p.region}`]
    if (!entry) {
      unmapped.add(`${p.country}/${p.region}`)
      result.push(o)
      continue
    }
    const timeline = typeof entry === 'string' ? [[-Infinity, entry]] : entry.map(([from, name], i) => [i === 0 ? -Infinity : from, name])
    const end = o.end ?? Infinity
    timeline.forEach(([from, name], i) => {
      const to = i + 1 < timeline.length ? timeline[i + 1][0] - 1 : Infinity
      const start = Math.max(o.start, from)
      const stop = Math.min(end, to)
      if (start > stop) return
      names.add(name)
      result.push({ province: o.province, occupier: name, start, end: stop === Infinity ? null : stop })
    })
  }
  // one canonical name per nation (spelling variants and renamings), then merge neighbouring spans
  // that now name the same occupier
  for (const o of result) {
    const fix = repairs.find((r) => r.occupier === o.occupier.trim() && o.start >= r.from && (o.end ?? Infinity) <= r.to)
    o.occupier = fix ? fix.become : (aliases[o.occupier] ?? o.occupier)
  }
  result.sort((a, b) => (a.province < b.province ? -1 : a.province > b.province ? 1 : a.start - b.start))
  const merged = []
  for (const o of result) {
    const last = merged[merged.length - 1]
    if (last && last.province === o.province && last.occupier === o.occupier && last.end !== null && last.end + 1 >= o.start) {
      last.end = o.end
    } else merged.push({ ...o })
  }
  return { occupations: merged, constituents: names.size, unmapped: [...unmapped] }
}

async function run() {
  const provinces = await readJson(path.join(RAW, 'provinces.json'))
  const existing = await readJson(path.join(RAW, 'cities.json')) // Wikidata cities from the old pipeline
  const places = (await populatedPlaces()).features.map((f) => ({
    name: f.properties.name,
    pop: f.properties.pop_max ?? 0,
    qid: f.properties.wikidataid ?? null,
    country: f.properties.adm0name,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }))
  // Natural Earth puts a second "Natal" (pop. 980,588) deep in Amazonas; the real city is on the northeast coast
  places.splice(0, places.length, ...places.filter((p) => !(p.name === 'Natal' && p.lon < -50)))
  const existingQids = new Set(existing.map((c) => c.qid))
  const norm = (n) => n.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  for (const p of places) p.historic = existingQids.has(p.qid)
  // Ancient cities missing from the modern populated-places list (Babylon, Carthage...) come in
  // from the old Wikidata import, with unknown population. The same city often sits in both lists
  // under a different QID or spelling, so match on name + proximity first (and mark the existing
  // entry historic) rather than adding a duplicate that a neighbouring province could "borrow".
  const placeQids = new Set(places.map((p) => p.qid))
  const modern = places.slice()
  for (const c of existing) {
    if (placeQids.has(c.qid)) continue
    const twin = modern.find((p) => Math.hypot(p.lon - c.lon, p.lat - c.lat) < 0.3 && norm(p.name) === norm(c.label))
    if (twin) twin.historic = true
    else places.push({ name: c.label, pop: 0, qid: c.qid, country: null, lon: c.lon, lat: c.lat, historic: true })
  }

  // Which province does each place fall in? (Places on a coast the simplified boundaries cut off are skipped.)
  const parts = []
  provinces.forEach((p, i) => {
    for (const polygon of p.geometry) parts.push({ polygon, bbox: ringBBox(polygon[0]), province: i })
  })
  const provinceIndex = buildIndex(parts)
  const members = provinces.map(() => [])
  for (const pl of places) {
    const hit = containing(provinceIndex, pl.lon, pl.lat)[0]
    if (hit !== undefined) members[parts[hit].province].push(pl)
  }

  // Biggest population wins, but cities from the old pipeline (Wikidata holdings, historical
  // significance) get a boost, so Rome beats a larger modern suburb while a random small town
  // that happens to be on the old list doesn't beat a metropolis. Ancient cities missing from the
  // modern list (Babylon, Carthage) have no population, so they count as ANCIENT_POP.
  const ANCIENT_POP = 500_000
  const score = (p) => (p.historic ? (p.pop > 0 ? p.pop * 3 : ANCIENT_POP) : p.pop)
  const bestOf = (list) => list.reduce((a, b) => (score(b) > score(a) ? b : a))

  // Provinces with no populated place inside (arctic, desert, remote ocean) borrow the nearest place
  // that no other province has claimed, so every province ends up with its own city.
  const listedCities = await readJson(new URL('./listed-cities.json', import.meta.url).pathname)
  for (const g of await readJson(new URL('./germany-seeds.json', import.meta.url).pathname)) {
    listedCities[`Germany/${g.region}`] = [g.city, g.lat, g.lon]
  }
  for (const [country, seeds] of Object.entries(await readJson(new URL('./seed-regions.json', import.meta.url).pathname))) {
    LISTED_COUNTRIES.add(country)
    for (const g of seeds) listedCities[`${country}/${g.region}`] = [g.city, g.lat, g.lon]
  }
  const enclaveConfig = await readJson(new URL('./enclaves.json', import.meta.url).pathname)
  for (const e of enclaveConfig.enclaves) {
    LISTED_COUNTRIES.add(e.country)
    listedCities[`${e.country}/${e.region}`] = e.city
  }
  const groups = await readJson(new URL('./county-groups.json', import.meta.url).pathname)
  const listedCityOf = (p) => {
    const t = LISTED_COUNTRIES.has(p.country) && ((groups[p.region]?.country === p.country ? groups[p.region].city : null) ?? listedCities[`${p.country}/${p.region}`] ?? (p.country === 'England' || p.country === 'Wales' ? listedCities[p.region] : null))
    return t ? { name: t[0], lat: t[1], lon: t[2], qid: null, country: p.country, pop: 0, listed: true } : null
  }
  const chosen = members.map((m, i) => listedCityOf(provinces[i]) ?? (m.length ? bestOf(m) : null))
  // Divisions with no town of their own (most French départements, some Spanish provinces) get
  // their administrative capital from Wikidata (P36) instead of a random far-away town.
  const capitals = await capitalsOf(provinces.filter((p, i) => !chosen[i] && p.qid).map((p) => p.qid))
  provinces.forEach((p, i) => {
    const c = !chosen[i] && p.qid && capitals.get(p.qid)
    if (c && !/^Q\d+$/.test(c.name)) chosen[i] = { ...c, country: p.country, pop: 0, capital: true }
  })
  const claimed = new Set(chosen.filter(Boolean))
  const claimedNames = new Set([...claimed].map((c) => norm(c.name)))
  let fallbacks = 0
  chosen.forEach((city, i) => {
    if (city) return
    fallbacks += 1
    // nearest unclaimed place, preferring the province's own country (no Tunisian town for Sardinia)
    const sameCountry = places.some((pl) => pl.country === provinces[i].country && !claimed.has(pl) && !claimedNames.has(norm(pl.name)))
    let bestD = Infinity
    for (const pl of places) {
      if (claimed.has(pl) || claimedNames.has(norm(pl.name))) continue
      if (sameCountry && pl.country !== provinces[i].country) continue
      const d = Math.hypot(pl.lon - provinces[i].seed[0], mercY(pl.lat) - mercY(provinces[i].seed[1]))
      if (d < bestD) {
        bestD = d
        chosen[i] = pl
      }
    }
    claimed.add(chosen[i])
    claimedNames.add(norm(chosen[i].name))
  })
  const out = provinces.map((p, i) => {
    const city = chosen[i]
    return {
      id: p.id,
      seed: p.seed,
      areaKm2: p.areaKm2,
      country: p.country,
      region: p.region,
      city: { name: city.name, lon: city.lon, lat: city.lat, qid: city.qid, country: city.country, source: city.listed ? 'listed' : city.capital ? 'capital' : members[i].length ? 'inside' : 'nearest' },
    }
  })
  // A coastal city can land a hair outside its province (the coastline is simplified), which would
  // put its dot in the sea. Nudge it to the nearest point just inside its own province.
  const inOwn = (c, i) => containing(provinceIndex, c.lon, c.lat).some((h) => parts[h].province === i)
  const notSnapped = []
  let snapped = 0
  chosen.forEach((city, i) => {
    if (inOwn(city, i)) return
    // nearest point of the province, searched outward from the city in a ring of directions
    for (let r = 0.004; r <= 0.25; r += 0.004) {
      for (let k = 0; k < 24; k += 1) {
        const lon = city.lon + r * Math.cos((k * Math.PI) / 12)
        const lat = city.lat + r * Math.sin((k * Math.PI) / 12)
        if (inOwn({ lon, lat }, i)) {
          chosen[i] = { ...city, lon: Math.round(lon * 1e4) / 1e4, lat: Math.round(lat * 1e4) / 1e4 }
          snapped += 1
          return
        }
      }
    }
    // a town borrowed from elsewhere (no town of its own) is outside by design
    if (members[i].length || city.listed || city.capital) notSnapped.push(`${provinces[i].region} (${city.name})`)
  })
  console.log(`${snapped} cities nudged inside their province` + (notSnapped.length ? `; still outside: ${notSnapped.join(', ')}` : ''))
  console.log(`${fallbacks} provinces had no populated place inside; used the nearest one`)

  // --- sample points per province: the city, the seed, and land points spread through the province ---
  const sample = provinces.map((p, i) => [[out[i].city.lon, out[i].city.lat], p.seed, ...p.samples])

  // --- occupation per era ---
  const files = (await fs.readdir(path.join(RAW, 'borders'))).filter((f) => yearFromFile(f) !== null)
  const eras = files.map((file) => ({ file, year: yearFromFile(file) })).sort((a, b) => a.year - b.year)
  const perProvince = provinces.map(() => [])
  for (const era of eras) {
    const geo = await readJson(path.join(RAW, 'borders', era.file))
    const polys = flattenPolygons(geo.features.filter((f) => f.properties?.NAME))
    const index = buildIndex(polys)
    provinces.forEach((_, i) => {
      const votes = new Map()
      sample[i].forEach(([x, y], n) => {
        const hit = containing(index, x, y)[0]
        if (hit === undefined) return
        const name = polys[hit].props.NAME
        votes.set(name, (votes.get(name) ?? 0) + (n === 0 ? 1.5 : 1)) // city counts a little extra
      })
      let best = null
      for (const [name, v] of votes) if (!best || v > best[1]) best = [name, v]
      perProvince[i].push({ year: era.year, occupier: best ? best[0] : null })
    })
    console.log(`  ${era.file}`)
  }

  // Collapse runs of identical occupiers into spans. A snapshot at year Y is taken to hold until
  // the next snapshot; the final one is open-ended (end = null).
  const occupations = []
  perProvince.forEach((rows, i) => {
    let start = 0
    for (let n = 1; n <= rows.length; n += 1) {
      if (n === rows.length || rows[n].occupier !== rows[start].occupier) {
        if (rows[start].occupier) {
          occupations.push({
            province: out[i].id,
            occupier: rows[start].occupier,
            start: rows[start].year,
            end: n === rows.length ? null : rows[n].year - 1,
          })
        }
        start = n
      }
    }
  })
  inheritRecords(occupations, out, enclaveConfig.inherit)
  applyTimelineGroups(occupations, out, await readJson(new URL('./napoleonic-conquests.json', import.meta.url).pathname), 'Napoleonic')
  applyTimelineGroups(occupations, out, await readJson(new URL('./ww2-conquests.json', import.meta.url).pathname), 'WW2')
  applyTimelineGroups(occupations, out, await readJson(new URL('./late-medieval-timelines.json', import.meta.url).pathname), 'Byzantine/Ottoman/Timurid')
  applyMongolConquests(occupations, out, await readJson(new URL('./mongol-conquests.json', import.meta.url).pathname))
  applyTimelineGroups(occupations, out, await readJson(new URL('./mongol-extras.json', import.meta.url).pathname), 'Mongol vassal')
  applyTimelineGroups(occupations, out, await readJson(new URL('./rus-principalities.json', import.meta.url).pathname), 'Rus principalities')
  applyTimelineGroups(occupations, out, await readJson(new URL('./anatolian-beyliks.json', import.meta.url).pathname), 'Anatolian beylik')
  applyTimelineGroups(occupations, out, await readJson(new URL('./serbian-empire.json', import.meta.url).pathname), 'Serbian Empire')
  applyTimelineGroups(occupations, out, await readJson(new URL('./africa-kingdoms.json', import.meta.url).pathname), 'African kingdom')
  applyTimelineGroups(occupations, out, await readJson(new URL('./ming-rise.json', import.meta.url).pathname), 'Ming founding')
  applyTimelineGroups(occupations, out, await readJson(new URL('./inner-asia.json', import.meta.url).pathname), 'Inner Asia')
  applyTimelineGroups(occupations, out, await readJson(new URL('./south-asia.json', import.meta.url).pathname), 'South Asia')
  applyTimelineGroups(occupations, out, await readJson(new URL('./ww2-pacific.json', import.meta.url).pathname), 'Pacific War')
  applyTimelineGroups(occupations, out, await readJson(new URL('./spanish-south-america.json', import.meta.url).pathname), 'Spanish South America')
  applyTimelineGroups(occupations, out, await readJson(new URL('./french-vassals.json', import.meta.url).pathname), 'French vassal')
  applyTimelineGroups(occupations, out, await readJson(new URL('./poland-lithuania.json', import.meta.url).pathname), 'Poland/Lithuania/Kalmar')
  applyOverrides(occupations, out, (await readJson(new URL('./occupation-overrides.json', import.meta.url).pathname)).overrides)
  applyTimelineGroups(occupations, out, await readJson(new URL('./piast-poland.json', import.meta.url).pathname), 'Piast Poland')
  applyTimelineGroups(occupations, out, await readJson(new URL('./golden-horde-successors.json', import.meta.url).pathname), 'Golden Horde successor')
  applyTimelineGroups(occupations, out, await readJson(new URL('./jalayirids.json', import.meta.url).pathname), 'Jalayirid')
  applyTimelineGroups(occupations, out, await readJson(new URL('./ceuta-gibraltar.json', import.meta.url).pathname), 'Ceuta and Gibraltar')
  applyTimelineGroups(occupations, out, await readJson(new URL('./turkey-republic.json', import.meta.url).pathname), 'Republic of Turkey')
  applyTimelineGroups(occupations, out, await readJson(new URL('./sierra-leone-liberia.json', import.meta.url).pathname), 'Sierra Leone/Liberia')
  const aliasConfig = await readJson(new URL('./occupier-aliases.json', import.meta.url).pathname)
  const { aliases } = aliasConfig
  splitCommonwealth(occupations, out, aliases)
  const split = splitHolyRomanEmpire(occupations, out, await readJson(new URL('./hre-constituents.json', import.meta.url).pathname), aliases, aliasConfig.repairs ?? [])
  console.log(`${split.occupations.length} occupation spans over ${eras.length} snapshots (Holy Roman Empire split into ${split.constituents} constituents` + (split.unmapped.length ? `; unmapped: ${split.unmapped.join(', ')}` : '') + ')')
  occupations.length = 0
  occupations.push(...split.occupations)
  spainFromCastile(occupations)
  claimBrazil(occupations, out, await readJson(new URL('./non-nations.json', import.meta.url).pathname))
  mergeTouching(occupations)
  carryPeoplesThroughGaps(occupations, out, await readJson(new URL('./non-nations.json', import.meta.url).pathname))
  mergeTouching(occupations)
  await fs.writeFile(path.join(RAW, 'province-data.json'), JSON.stringify({ provinces: out, occupations }))
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
