// Small planar geometry helpers shared by the province scripts.
// Provinces are built in "Mercator degrees" (x = lon, y = Mercator-projected lat,
// in degrees) so a planar Voronoi there looks round on the Leaflet map.

export const MAX_LAT = 85

export function mercY(lat) {
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180
  return (Math.log(Math.tan(Math.PI / 4 + phi / 2)) * 180) / Math.PI
}

export function unMercY(y) {
  return ((2 * Math.atan(Math.exp((y * Math.PI) / 180)) - Math.PI / 2) * 180) / Math.PI
}

export function ringBBox(ring) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of ring) {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return [x0, y0, x1, y1]
}

export function inRing(x, y, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// polygon = [outer, ...holes], each a ring of [lon, lat]; bbox precomputed on the outer ring.
export function inPolygon(x, y, polygon, bbox) {
  if (x < bbox[0] || x > bbox[2] || y < bbox[1] || y > bbox[3]) return false
  if (!inRing(x, y, polygon[0])) return false
  for (let i = 1; i < polygon.length; i += 1) if (inRing(x, y, polygon[i])) return false
  return true
}

// Flattens Polygon/MultiPolygon features into [{ polygon, bbox, props }].
export function flattenPolygons(features) {
  const out = []
  for (const f of features) {
    const g = f.geometry
    if (!g) continue
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    for (const polygon of polys) out.push({ polygon, bbox: ringBBox(polygon[0]), props: f.properties })
  }
  return out
}

// Coarse spatial index so point-in-polygon tests only look at nearby polygons.
const BIN = 5
export function buildIndex(polys) {
  const bins = new Map()
  polys.forEach((p, i) => {
    for (let bx = Math.floor(p.bbox[0] / BIN); bx <= Math.floor(p.bbox[2] / BIN); bx += 1) {
      for (let by = Math.floor(p.bbox[1] / BIN); by <= Math.floor(p.bbox[3] / BIN); by += 1) {
        const key = `${bx},${by}`
        if (!bins.has(key)) bins.set(key, [])
        bins.get(key).push(i)
      }
    }
  })
  return { polys, bins }
}

// Indices of polygons containing (x, y), in source order.
export function containing(index, x, y) {
  const hits = []
  for (const i of index.bins.get(`${Math.floor(x / BIN)},${Math.floor(y / BIN)}`) ?? []) {
    const p = index.polys[i]
    if (inPolygon(x, y, p.polygon, p.bbox)) hits.push(i)
  }
  return hits
}

// Douglas-Peucker on a closed ring; returns null when fewer than 4 points survive.
export function simplifyRing(ring, tol) {
  const pts = ring.slice(0, -1)
  if (pts.length < 4) return null
  let far = 0
  let farD = -1
  for (let i = 1; i < pts.length; i += 1) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1])
    if (d > farD) {
      farD = d
      far = i
    }
  }
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[far] = 1
  const stack = [
    [0, far],
    [far, pts.length],
  ]
  while (stack.length) {
    const [a, b] = stack.pop()
    const pa = pts[a]
    const pb = pts[b % pts.length]
    const dx = pb[0] - pa[0]
    const dy = pb[1] - pa[1]
    const len = Math.hypot(dx, dy)
    let maxD = 0
    let idx = -1
    for (let i = a + 1; i < b; i += 1) {
      const p = pts[i]
      const d = len === 0 ? Math.hypot(p[0] - pa[0], p[1] - pa[1]) : Math.abs(dy * (p[0] - pa[0]) - dx * (p[1] - pa[1])) / len
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (maxD > tol) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  const out = pts.filter((_, i) => keep[i])
  if (out.length < 3) return null
  out.push(out[0])
  return out.length >= 4 ? out : null
}

// Simplifies a polygon ([outer, ...holes]); null if the outer ring collapses.
export function simplifyPolygon(polygon, tol) {
  const outer = simplifyRing(polygon[0], tol)
  if (!outer) return null
  const holes = polygon.slice(1).map((r) => simplifyRing(r, tol)).filter(Boolean)
  return [outer, ...holes]
}
