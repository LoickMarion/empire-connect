import { Delaunay } from 'd3-delaunay'

// [xmin, ymin, xmax, ymax] with x=lon, y=lat.
const WORLD_BOUNDS = [-180, -90, 180, 90]

export function buildVoronoi(cities) {
  const points = cities.map((c) => [c.lon, c.lat])
  const delaunay = Delaunay.from(points)
  return delaunay.voronoi(WORLD_BOUNDS)
}

// Leaflet positions ([lat, lon] pairs) for city index i's Voronoi cell, or null.
export function cellPositions(voronoi, index) {
  const polygon = voronoi.cellPolygon(index)
  if (!polygon) return null
  return polygon.map(([lon, lat]) => [lat, lon])
}
