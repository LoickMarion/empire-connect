// Divides the world's land into ~1000 provinces that follow current administrative borders.
//
//  1. Zones: every country (Natural Earth admin-0), except the countries in policy.mjs
//     ADMIN1_COUNTRIES, which use their states / provinces / departments (admin-1) instead.
//  2. Tiny zones (microstates, tiny US states) merge into a neighbour, or are dropped.
//  3. Each zone gets a province count n: set by policy for admin-1 countries, otherwise by
//     land area weighted by density.mjs (small provinces in high-churn regions).
//  4. A zone with n > 1 is cut by weighted k-means + Voronoi, clipped to the zone, so a
//     province never crosses a zone border.
// Writes data/raw/provinces.json. Deterministic.
import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Delaunay } from 'd3-delaunay'
import { geoArea } from 'd3-geo'
import polygonClipping from 'polygon-clipping'
import { buildIndex, containing, inPolygon, ringBBox, mercY, simplifyPolygon, unMercY } from './lib/geo.mjs'
import { densityFactor } from './lib/density.mjs'
import { makeWarp, warpRing } from './lib/warp.mjs'
import {
  ADMIN1_COUNTRIES,
  IRISH_COUNTY_ALIASES,
  ISLAND_MERGE_DEG,
  NORTHERN_IRELAND,
  SCOTLAND,
  WALES,
  MIN_COUNTRY_KM2,
  MIN_ISLAND_KM2,
  SKIP_ADMIN,
  SPLIT_OVERRIDES,
} from './lib/policy.mjs'

// Neighbouring historic counties merged into one province (Scotland and Ireland are kept coarse).
const COUNTY_GROUPS = JSON.parse(readFileSync(new URL('./county-groups.json', import.meta.url), 'utf8'))
const GROUP_OF = new Map(Object.entries(COUNTY_GROUPS).flatMap(([name, g]) => g.counties.map((c) => [`${g.country}/${c}`, name])))

// Countries divided by hand-placed seed cities (EU4-style historic provinces): each seed's province
// is its Voronoi cell clipped to the country. Aland, Western Sahara and Somaliland are separate "countries" in
// Natural Earth but are folded into Finland, Morocco and Somalia here.
const SEED_REGIONS = JSON.parse(readFileSync(new URL('./seed-regions.json', import.meta.url), 'utf8'))
const MERGE_INTO = { Aland: 'Finland', 'Western Sahara': 'Morocco', Somaliland: 'Somalia' }
// Natural Earth draws Crimea inside Russia; we use the internationally recognised border instead.
const CRIMEA_BOX = [32, 44, 37, 46.5]
const inCrimea = (polygon) => {
  const [x0, y0, x1, y1] = ringBBox(polygon[0])
  return x0 >= CRIMEA_BOX[0] && x1 <= CRIMEA_BOX[2] && y0 >= CRIMEA_BOX[1] && y1 <= CRIMEA_BOX[3]
}



const TARGET = 2440 // the fixed-division countries (France, US, Spain, UK, Germany, Scandinavia, the Balkans, Eastern Europe...) take ~900 of these
const GRID_STEP = 0.25 // degrees
const SIMPLIFY_TOL = 0.004 // degrees (~400 m), applied to source boundaries
const OUTPUT_TOL = 0.01 // degrees, applied to finished provinces
const ITERATIONS = 40
const ADJACENT_DEG = 0.03
const SAMPLES = 5
const EARTH_KM2 = 510_065_600
const OUT_DIR = new URL('../../data/raw/', import.meta.url).pathname
const NE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson'

async function cached(name) {
  const dest = path.join(OUT_DIR, 'natural-earth', name)
  try {
    return JSON.parse(await fs.readFile(dest, 'utf8'))
  } catch {
    console.log(`downloading ${name}...`)
    const res = await fetch(`${NE_URL}/${name}`)
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
    const text = await res.text()
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.writeFile(dest, text)
    return JSON.parse(text)
  }
}

function mulberry32(seed) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// geoArea assumes d3's winding convention; source winding varies, so take the smaller of the
// polygon and its complement (every region here is far smaller than a hemisphere).
function polygonsKm2(polygons) {
  let total = 0
  for (const coordinates of polygons) {
    const sr = geoArea({ type: 'Polygon', coordinates })
    total += Math.min(sr, 4 * Math.PI - sr)
  }
  return total * (EARTH_KM2 / (4 * Math.PI))
}

const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d
const cellKm2 = (lat) => GRID_STEP * GRID_STEP * 111.2 * 111.2 * Math.cos((lat * Math.PI) / 180)

function strided(list, k) {
  if (list.length <= k) return list
  return Array.from({ length: k }, (_, i) => list[Math.floor(((i + 0.5) * list.length) / k)])
}

// ---------------------------------------------------------------- zones
function zonePolygons(feature) {
  const g = feature.geometry
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  return polys.map((p) => simplifyPolygon(p, SIMPLIFY_TOL)).filter(Boolean)
}

// Germany: every district (Kreis) goes to the nearest territorial seed city; a free city takes only
// the urban district it sits in. Province borders are therefore real district borders.
function buildGermanyZones(kreise, seeds) {
  const bboxArea = ([x0, y0, x1, y1]) => (x1 - x0) * (y1 - y0)
  const items = kreise.features
    .map((f) => {
      const polys = zonePolygons(f)
      if (!polys.length) return null
      const big = polys.reduce((a, b) => (bboxArea(ringBBox(b[0])) > bboxArea(ringBBox(a[0])) ? b : a))
      const [x0, y0, x1, y1] = ringBBox(big[0])
      return { f, polys, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, km2: polygonsKm2(polys), bboxes: polys.map((p) => ({ polygon: p, bbox: ringBBox(p[0]) })) }
    })
    .filter(Boolean)
  const containsPoint = (it, lon, lat) => it.bboxes.some((b) => inPolygon(lon, lat, b.polygon, b.bbox))
  const owner = new Map() // kreis item -> seed
  const territorial = []
  for (const seed of seeds) {
    const urban = seed.free && items.find((it) => containsPoint(it, seed.lon, seed.lat) && it.km2 < 1500 && !/Landkreis/.test(it.f.properties.NAME_LATN))
    if (urban && !owner.has(urban)) owner.set(urban, seed)
    else territorial.push(seed)
  }
  for (const it of items) {
    if (owner.has(it)) continue
    let best = null
    for (const seed of territorial) {
      const d = Math.hypot((seed.lon - it.cx) * Math.cos((seed.lat * Math.PI) / 180), seed.lat - it.cy)
      if (!best || d < best[1]) best = [seed, d]
    }
    owner.set(it, best[0])
  }
  const bySeed = new Map()
  for (const [it, seed] of owner) bySeed.set(seed, [...(bySeed.get(seed) ?? []), it])
  const zones = []
  for (const seed of seeds) {
    const members = bySeed.get(seed)
    if (!members) {
      console.log(`germany: seed ${seed.region} got no districts`)
      continue
    }
    const polygons = polygonClipping.union(...members.map((m) => m.polys))
    zones.push({ country: 'Germany', region: seed.region, polygons, admin1: true })
  }
  return zones
}

// Natural Earth draws the Gaza Strip as its own small polygon inside Israel; it becomes its own zone.
const GAZA_BOX = [34.1, 34.7, 31.1, 31.7]
const inGaza = (polygon) => {
  const [x0, y0, x1, y1] = ringBBox(polygon[0])
  return x0 >= GAZA_BOX[0] && x1 <= GAZA_BOX[1] && y0 >= GAZA_BOX[2] && y1 <= GAZA_BOX[3]
}

function buildZones(admin0, admin1, historicCounties, germany) {
  const zones = []
  for (const f of admin0.features) {
    const country = f.properties.ADMIN
    if (SKIP_ADMIN.has(country) || ADMIN1_COUNTRIES[country] || MERGE_INTO[country] || country === 'Palestine') continue
    const seedList = SEED_REGIONS[country]
    const extra = Object.entries(MERGE_INTO).filter(([, into]) => into === country).flatMap(([name]) => admin0.features.filter((g) => g.properties.ADMIN === name))
    let polygons = [f, ...extra].flatMap(zonePolygons)
    if (country === 'Russia') polygons = polygons.filter((p) => !inCrimea(p))
    if (country === 'Ukraine') {
      const russia = admin0.features.find((g) => g.properties.ADMIN === 'Russia')
      polygons.push(...zonePolygons(russia).filter(inCrimea))
    }
    if (country === 'Israel') {
      // the West Bank joins Israel's zone; the Gaza Strip is split off below
      polygons.push(...admin0.features.filter((g) => g.properties.ADMIN === 'Palestine').flatMap(zonePolygons))
      zones.push({ country: 'Palestine', region: 'Gaza', polygons: polygons.filter(inGaza), seedList: SEED_REGIONS.Palestine })
      polygons = polygons.filter((p) => !inGaza(p))
    }
    zones.push({ country, region: country, polygons, seedList })
  }
  const irish = new Map() // county -> polygons, so city/district splits merge back into their county
  for (const f of admin1.features) {
    const country = f.properties.admin
    if (!ADMIN1_COUNTRIES[country] || ADMIN1_COUNTRIES[country].source) continue
    if (country === 'Ireland') {
      const county = IRISH_COUNTY_ALIASES[f.properties.name] ?? f.properties.name
      irish.set(county, [...(irish.get(county) ?? []), ...zonePolygons(f)])
      continue
    }
    zones.push({ country, region: f.properties.name ?? f.properties.woe_name ?? country, polygons: zonePolygons(f), admin1: true, qid: f.properties.wikidataid ?? null })
  }
  for (const [county, polys] of irish) {
    // dissolve the pieces so no internal borders show
    const merged = polygonClipping.union(...polys.map((p) => [p]))
    zones.push({ country: 'Ireland', region: county, polygons: merged, admin1: true })
  }
  for (const f of historicCounties.features) {
    const name = f.properties.NAME
    const country = NORTHERN_IRELAND.has(name) ? 'Northern Ireland' : SCOTLAND.has(name) ? 'Scotland' : WALES.has(name) ? 'Wales' : 'England'
    zones.push({ country, region: name, polygons: zonePolygons(f), admin1: true, policyCountry: 'United Kingdom' })
  }
  zones.push(...buildGermanyZones(germany.kreise, germany.seeds))

  // Fold grouped counties into one zone (dissolving the shared borders).
  const grouped = new Map()
  const kept = []
  for (const z of zones) {
    const group = GROUP_OF.get(`${z.country}/${z.region}`)
    if (!group) kept.push(z)
    else grouped.set(group, [...(grouped.get(group) ?? []), z])
  }
  zones.length = 0
  zones.push(...kept)
  for (const [name, members] of grouped) {
    const polygons = polygonClipping.union(...members.map((m) => m.polygons))
    zones.push({ country: members[0].country, region: name, polygons, admin1: true, policyCountry: members[0].country === 'Ireland' ? 'Ireland' : 'United Kingdom' })
  }
  for (const z of zones) {
    z.polygons = z.polygons.filter((p) => ringBBox(p[0])[3] > -60) // drops Antarctic bits
    z.areaKm2 = polygonsKm2(z.polygons)
  }
  return zones.filter((z) => z.polygons.length)
}

const policyOf = (z) => ADMIN1_COUNTRIES[z.policyCountry ?? z.country]
const minKm2 = (z) => (z.seedList ? 0 : z.admin1 ? policyOf(z).minKm2 : MIN_COUNTRY_KM2)

// Folds zones below their minimum size into the neighbour they share the most border with
// (admin-1 units: same country only). A small zone with no neighbour survives if it's an island
// big enough to matter; otherwise it joins the nearest zone within ISLAND_MERGE_DEG, or is dropped.
function mergeSmallZones(zones) {
  const k = 1 / ADJACENT_DEG
  const vertexHash = new Map()
  zones.forEach((z, i) => {
    for (const poly of z.polygons) {
      for (const [x, y] of poly[0]) {
        const key = `${Math.floor(x * k)},${Math.floor(y * k)}`
        if (!vertexHash.has(key)) vertexHash.set(key, [])
        vertexHash.get(key).push([i, x, y])
      }
    }
  })
  const owner = zones.map((_, i) => i) // zone index -> index of the zone it was merged into
  const root = (i) => (owner[i] === i ? i : (owner[i] = root(owner[i])))
  const alive = new Set(zones.map((_, i) => i))
  const settled = new Set()
  let merged = 0
  let dropped = 0

  const absorb = (from, into) => {
    zones[into].polygons.push(...zones[from].polygons)
    zones[into].areaKm2 += zones[from].areaKm2
    owner[from] = into
    alive.delete(from)
    merged += 1
  }

  for (;;) {
    const i = [...alive]
      .filter((j) => !settled.has(j) && zones[j].areaKm2 < minKm2(zones[j]))
      .sort((a, b) => zones[a].areaKm2 - zones[b].areaKm2)[0]
    if (i === undefined) break
    const z = zones[i]
    const allowed = (j) => !z.admin1 || zones[j].country === z.country

    const shared = new Map()
    for (const poly of z.polygons) {
      for (const [x, y] of poly[0]) {
        const bx = Math.floor(x * k)
        const by = Math.floor(y * k)
        for (let dx = -1; dx <= 1; dx += 1) {
          for (let dy = -1; dy <= 1; dy += 1) {
            for (const [o, ox, oy] of vertexHash.get(`${bx + dx},${by + dy}`) ?? []) {
              const r = root(o)
              if (r !== i && alive.has(r) && allowed(r) && Math.hypot(ox - x, oy - y) < ADJACENT_DEG) {
                shared.set(r, (shared.get(r) ?? 0) + 1)
              }
            }
          }
        }
      }
    }
    const best = [...shared].sort((a, b) => b[1] - a[1])[0]
    if (best) {
      absorb(i, best[0])
      continue
    }
    if (z.areaKm2 >= MIN_ISLAND_KM2) {
      settled.add(i)
      continue
    }
    let nearest = null
    for (const j of alive) {
      if (j === i || !allowed(j)) continue
      for (const poly of zones[j].polygons) {
        for (const v of poly[0]) {
          const d = Math.hypot(v[0] - z.polygons[0][0][0][0], v[1] - z.polygons[0][0][0][1])
          if (d < ISLAND_MERGE_DEG && (!nearest || d < nearest[1])) nearest = [j, d]
        }
      }
    }
    if (nearest) absorb(i, nearest[0])
    else {
      alive.delete(i)
      dropped += 1
    }
  }
  console.log(`merged ${merged} small zones into neighbours, dropped ${dropped}`)
  return [...alive].map((i) => zones[i])
}

// ---------------------------------------------------------------- main
async function main() {
  const [admin0, admin1] = await Promise.all([
    cached('ne_10m_admin_0_countries.geojson'),
    cached('ne_10m_admin_1_states_provinces.geojson'),
  ])
  const historicCounties = JSON.parse(await fs.readFile(path.join(OUT_DIR, 'historic-counties/counties.geojson'), 'utf8'))
  const germany = {
    kreise: JSON.parse(await fs.readFile(path.join(OUT_DIR, 'germany/districts.geojson'), 'utf8')),
    seeds: JSON.parse(await fs.readFile(new URL('./germany-seeds.json', import.meta.url), 'utf8')),
  }
  let zones = buildZones(admin0, admin1, historicCounties, germany)
  console.log(`${zones.length} zones before merging`)
  zones = mergeSmallZones(zones)
  console.log(`${zones.length} zones`)

  // --- land grid labelled by zone ---
  const flat = []
  zones.forEach((z, zone) => {
    for (const polygon of z.polygons) flat.push({ polygon, bbox: ringBBox(polygon[0]), zone })
  })
  const index = buildIndex(flat)
  const byZone = zones.map(() => [])
  let sampleCount = 0
  for (let lat = -59.9; lat < 84; lat += GRID_STEP) {
    for (let lon = -179.9; lon < 180; lon += GRID_STEP) {
      const hit = containing(index, lon, lat)[0]
      if (hit === undefined) continue
      byZone[flat[hit].zone].push({ x: lon, y: mercY(lat), lon, lat, km2: cellKm2(lat), f: densityFactor(lon, lat) })
      sampleCount += 1
    }
  }
  console.log(`${sampleCount} land samples`)

  // --- province count per zone ---
  const fixed = zones.map((z) => {
    if (z.seedList) return z.seedList.length
    if (!z.admin1) return null
    const policy = policyOf(z)
    const override = SPLIT_OVERRIDES[`${z.country}/${z.region}`]
    if (override) return override
    if (!policy.splitKm2) return 1
    return Math.max(1, Math.min(policy.maxSplit, Math.round(z.areaKm2 / policy.splitKm2)))
  })
  const fixedTotal = fixed.reduce((s, n) => s + (n ?? 0), 0)
  const massKm2 = byZone.map((m) => m.reduce((s, p) => s + p.km2 / p.f, 0))
  const countFor = (a0) => zones.map((_, zi) => fixed[zi] ?? Math.max(1, Math.round(massKm2[zi] / a0)))
  let lo = 2000
  let hi = 2_000_000
  for (let i = 0; i < 50; i += 1) {
    const mid = (lo + hi) / 2
    if (countFor(mid).reduce((s, n) => s + n, 0) > TARGET) lo = mid
    else hi = mid
  }
  const counts = countFor(hi).map((n, zi) => Math.min(n, Math.max(1, byZone[zi].length)))
  console.log(`${fixedTotal} provinces set by admin-1 policy; typical other province ~${Math.round(hi).toLocaleString()} km2 x density`)

  // --- cut each zone ---
  const provinces = []
  zones.forEach((zone, zi) => {
    const members = byZone[zi]
    const n = counts[zi]
    // only an undivided admin-1 unit can use its own capital as its city
    const base = { country: zone.country, region: zone.region, qid: n === 1 ? zone.qid ?? null : null }

    if (n === 1 && !zone.seedList) {
      const m = members.reduce((a, p) => ({ x: a.x + p.x * p.km2, y: a.y + p.y * p.km2, w: a.w + p.km2 }), { x: 0, y: 0, w: 0 })
      const seed = m.w ? [m.x / m.w, unMercY(m.y / m.w)] : zone.polygons[0][0][0]
      provinces.push({ ...base, seed, members: strided(members, SAMPLES), areaKm2: Math.round(zone.areaKm2), geometry: zone.polygons })
      return
    }

    let seeds
    if (zone.seedList) {
      seeds = zone.seedList.map((sd) => [sd.lon, mercY(sd.lat)])
    } else {
      // weighted k-means inside the zone
      const rand = mulberry32(1000 + zi)
      const total = members.reduce((s, p) => s + p.km2 / p.f, 0)
      seeds = []
      const taken = new Set()
      while (seeds.length < n) {
        let r = rand() * total
        let i = 0
        for (; i < members.length - 1; i += 1) {
          r -= members[i].km2 / members[i].f
          if (r <= 0) break
        }
        if (taken.has(i)) continue
        taken.add(i)
        seeds.push([members[i].x, members[i].y])
      }
      const assign = new Int32Array(members.length).fill(-1)
      for (let it = 0; it < ITERATIONS; it += 1) {
        const d = Delaunay.from(seeds)
        const sx = new Float64Array(n)
        const sy = new Float64Array(n)
        const sm = new Float64Array(n)
        let moved = 0
        members.forEach((p, i) => {
          const c = d.find(p.x, p.y)
          if (c !== assign[i]) moved += 1
          assign[i] = c
          const w = p.km2 / p.f
          sx[c] += p.x * w
          sy[c] += p.y * w
          sm[c] += w
        })
        seeds = seeds.map((s, c) => (sm[c] > 0 ? [sx[c] / sm[c], sy[c] / sm[c]] : s))
        if (moved === 0) break
      }
    }

    // Voronoi of the seeds over the zone's bounding box, clipped to the zone
    const polysMerc = zone.polygons.map((poly) => poly.map((ring) => ring.map(([x, y]) => [x, mercY(y)])))
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const poly of polysMerc) {
      const [a, b, c, d] = ringBBox(poly[0])
      x0 = Math.min(x0, a)
      y0 = Math.min(y0, b)
      x1 = Math.max(x1, c)
      y1 = Math.max(y1, d)
    }
    const delaunay = Delaunay.from(seeds)
    const voronoi = delaunay.voronoi([x0 - 3, y0 - 3, x1 + 3, y1 + 3])

    // Every divided zone gets meandering borders: warp the Voronoi diagram with smooth noise, scaled
    // to the typical spacing between this zone's seeds.
    let warp = null
    let step = 0
    if (seeds.length > 1) {
      const nearest = seeds.map((a, i) => Math.min(...seeds.filter((_, j) => j !== i).map((b) => Math.hypot(a[0] - b[0], a[1] - b[1]))))
      const size = nearest.sort((a, b) => a - b)[nearest.length >> 1]
      warp = makeWarp(size, zi + 1, seeds)
      step = Math.max(0.01, size * 0.012)
    }

    const cells = []
    seeds.forEach((s, c) => {
      let cell = voronoi.cellPolygon(c)
      if (!cell) return
      if (warp) cell = warpRing(cell, warp, step)
      const pieces = []
      for (const poly of polysMerc) pieces.push(...polygonClipping.intersection([cell], poly))
      if (!pieces.length) return
      const geometry = pieces.map((poly) => poly.map((ring) => ring.map(([x, y]) => [x, unMercY(y)])))
      cells.push({ c, s, geometry })
    })

    // Sample points for the occupation lookup come from the finished (warped) shapes.
    const cellBoxes = cells.map((cell) => cell.geometry.map((g) => ({ polygon: g, bbox: ringBBox(g[0]) })))
    const memberCell = members.map((p) => {
      const i = cellBoxes.findIndex((boxes) => boxes.some((b) => inPolygon(p.lon, p.lat, b.polygon, b.bbox)))
      return i >= 0 ? i : cells.findIndex((cell) => cell.c === delaunay.find(p.x, p.y))
    })
    cells.forEach(({ c, s, geometry }, ci) => {
      provinces.push({
        ...base,
        seeded: !!zone.seedList,
        region: zone.seedList ? zone.seedList[c].region : base.region,
        seed: [s[0], unMercY(s[1])],
        members: strided(members.filter((_, i) => memberCell[i] === ci), SAMPLES),
        areaKm2: Math.round(polygonsKm2(geometry)),
        geometry,
      })
    })
  })

  // The warp can occasionally fold a border over itself, leaving a small piece of one province
  // stranded inside another. A real island has sea around it, so a small fragment whose middle lies
  // inside a *different* province is such an artifact: hand it to the province around it.
  {
    const parts = []
    provinces.forEach((p, pi) => p.geometry.forEach((polygon) => parts.push({ polygon, bbox: ringBBox(polygon[0]), province: pi })))
    const index = buildIndex(parts)
    let moved = 0
    provinces.forEach((p, pi) => {
      if (!p.seeded || p.geometry.length < 2) return
      const keep = []
      for (const polygon of p.geometry) {
        const km2 = polygonsKm2([polygon])
        const ring = polygon[0]
        const probes = [0, 1, 2].map((k) => [0, 1, 2].reduce((a, j) => [a[0] + ring[(k + j) % (ring.length - 1)][0] / 3, a[1] + ring[(k + j) % (ring.length - 1)][1] / 3], [0, 0]))
        const inside = probes.find(([x, y]) => inPolygon(x, y, polygon, ringBBox(ring)))
        const host = inside && km2 < 2000 ? containing(index, inside[0], inside[1]).map((h) => parts[h].province).find((q) => q !== pi) : undefined
        if (host === undefined) keep.push(polygon)
        else {
          provinces[host].geometry = polygonClipping.union(provinces[host].geometry, [polygon])
          moved += 1
          if (process.env.DEBUG_FRAGMENTS) console.log(`  ${p.country}/${p.region} -> ${provinces[host].region}: ${Math.round(km2)} km2 at ${inside.map((v) => v.toFixed(2))}`)
        }
      }
      p.geometry = keep
    })
    console.log(`reassigned ${moved} stranded fragments`)
  }

  // Hand-drawn enclaves (enclaves.json): a piece cut out of the provinces around it becomes a province.
  for (const e of JSON.parse(readFileSync(new URL('./enclaves.json', import.meta.url), 'utf8')).enclaves) {
    let piece = []
    const hosts = [
      ...(e.from ?? []).map((key) => {
        const host = provinces.find((p) => `${p.country}/${p.region}` === key)
        if (!host) throw new Error(`enclaves.json: no province ${key}`)
        return host
      }),
      ...(e.fromAt ?? []).map(([x, y]) => {
        const host = provinces.find((p) => p.geometry.some((poly) => inPolygon(x, y, poly, ringBBox(poly[0]))))
        if (!host) throw new Error(`enclaves.json: no province at ${x},${y}`)
        return host
      }),
    ]
    for (const host of new Set(hosts)) {
      const cut = polygonClipping.intersection(host.geometry, e.polygon)
      if (!cut.length) continue
      piece = piece.length ? polygonClipping.union(piece, cut) : cut
      host.geometry = polygonClipping.difference(host.geometry, e.polygon)
      host.areaKm2 = Math.round(polygonsKm2(host.geometry))
    }
    if (!piece.length) throw new Error(`enclaves.json: ${e.region} overlaps none of its host provinces`)
    provinces.push({
      country: e.country,
      region: e.region,
      qid: null,
      seeded: true,
      seed: [e.city[2], e.city[1]],
      members: e.samples.map(([lon, lat]) => ({ lon, lat })),
      areaKm2: Math.round(polygonsKm2(piece)),
      geometry: piece,
    })
  }

  // simplify + round the finished geometry
  for (const p of provinces) {
    p.geometry = p.geometry
      .map((poly) => simplifyPolygon(poly, OUTPUT_TOL))
      .filter(Boolean)
      .map((poly) => poly.map((ring) => ring.map(([x, y]) => [round(x), round(y)])))
    p.seed = [round(p.seed[0]), round(p.seed[1])]
    p.samples = p.members.map((m) => [round(m.lon), round(m.lat)])
    delete p.members
  }
  const kept = provinces.filter((p) => p.geometry.length)

  // Sort north->south, west->east for stable, readable ids.
  kept.sort((a, b) => b.seed[1] - a.seed[1] || a.seed[0] - b.seed[0])
  kept.forEach((p, i) => {
    p.id = `p${String(i + 1).padStart(4, '0')}`
  })

  await fs.writeFile(path.join(OUT_DIR, 'provinces.json'), JSON.stringify(kept))
  const areas = kept.map((p) => p.areaKm2).sort((a, b) => a - b)
  console.log(`${kept.length} provinces; area km2 min ${areas[0]}, median ${areas[areas.length >> 1]}, max ${areas.at(-1)}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
