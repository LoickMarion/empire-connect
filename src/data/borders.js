// Lazy loading of per-era border GeoJSON files (public/data/borders/*.geojson).
// Era metadata itself comes from dataSource.js's getBorderEras().

export function pickEraForYear(eras, year) {
  if (eras.length === 0) return null
  const before = eras.filter((e) => e.eraYear <= year)
  if (before.length > 0) return before[before.length - 1]
  return eras[0]
}

const geojsonCache = new Map()

export async function loadEraGeoJSON(file) {
  if (!geojsonCache.has(file)) {
    geojsonCache.set(
      file,
      fetch(`${import.meta.env.BASE_URL}data/${file}`).then((r) => r.json()),
    )
  }
  return geojsonCache.get(file)
}
