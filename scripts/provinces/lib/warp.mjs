// Smooth "domain warp" used to turn the straight lines of a Voronoi diagram into meandering,
// natural-looking borders. Every vertex is displaced by the same continuous noise field, so
// neighbouring cells still share their edges exactly: the warped diagram has no gaps or overlaps.

function hash(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296 // [0, 1)
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)

// Value noise in [-1, 1].
function noise(x, y, seed) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = fade(x - ix)
  const fy = fade(y - iy)
  const v = (dx, dy) => hash(ix + dx, iy + dy, seed) * 2 - 1
  const top = v(0, 0) + (v(1, 0) - v(0, 0)) * fx
  const bottom = v(0, 1) + (v(1, 1) - v(0, 1)) * fx
  return top + (bottom - top) * fy
}

// Three octaves, scaled to `size` (roughly the spacing between neighbouring province seeds).
// Amplitudes and wavelengths are chosen so the field's slope stays well under 1: a slope
// above 1 would fold the diagram over itself.
const OCTAVES = [
  { wavelength: 2.4, amplitude: 0.3 }, // broad drift: irregular province shapes and sizes
  { wavelength: 1.0, amplitude: 0.12 },
  { wavelength: 0.42, amplitude: 0.09 },
  { wavelength: 0.17, amplitude: 0.045 }, // river-and-ridge scale squiggle
  { wavelength: 0.07, amplitude: 0.02 },
  { wavelength: 0.03, amplitude: 0.008 },
]
const MIN_WAVELENGTH_DEG = 0.04 // finer than this is lost to simplification anyway

// `seeds` ([x, y] points) are held still: the warp fades to nothing close to each one, so a seed
// (and the city standing on it) always stays inside its own province.
export function makeWarp(size, seed = 1, seeds = []) {
  const r0 = 0.08 * size
  const r1 = 0.3 * size
  const octaves = OCTAVES.filter((o) => o.wavelength * size >= MIN_WAVELENGTH_DEG)
  return ([x, y]) => {
    // First bend the lookup coordinates with a slow field, so the finer octaves meander and lobe
    // (the way rivers and valleys do) instead of just jittering.
    const bx = 0.45 * size * noise(x / (1.7 * size) + 5.1, y / (1.7 * size) + 2.3, seed * 5 + 101)
    const by = 0.45 * size * noise(x / (1.7 * size) + 8.9, y / (1.7 * size) + 6.7, seed * 5 + 202)
    const qx = x + bx
    const qy = y + by
    let dx = 0
    let dy = 0
    for (const [i, { wavelength, amplitude }] of octaves.entries()) {
      const k = 1 / (wavelength * size)
      dx += amplitude * size * noise(qx * k, qy * k, seed * 7 + i)
      dy += amplitude * size * noise(qx * k + 91.7, qy * k + 33.3, seed * 13 + i)
    }
    let taper = 1
    if (seeds.length) {
      let d = Infinity
      for (const [sx, sy] of seeds) d = Math.min(d, Math.hypot(x - sx, y - sy))
      const t = Math.max(0, Math.min(1, (d - r0) / (r1 - r0)))
      taper = t * t * (3 - 2 * t)
    }
    return [x + dx * taper, y + dy * taper]
  }
}

// Subdivides each edge of a closed ring (so it can bend), then warps every point. Edges are
// subdivided from a canonical endpoint so both cells sharing an edge get identical points.
export function warpRing(ring, warp, step) {
  const out = []
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = ring[i]
    const b = ring[i + 1]
    const forward = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1])
    const [p, q] = forward ? [a, b] : [b, a]
    const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / step))
    const pts = []
    for (let j = 0; j < n; j += 1) pts.push([p[0] + ((q[0] - p[0]) * j) / n, p[1] + ((q[1] - p[1]) * j) / n])
    if (!forward) {
      pts.reverse()
      // reversed run starts at the point just before q; the edge must start at a (== q)
      pts.unshift(q)
      pts.pop()
    }
    out.push(...pts.map(warp))
  }
  out.push(out[0])
  return out
}
