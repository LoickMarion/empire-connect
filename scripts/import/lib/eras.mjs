// The full list of snapshot files available in aourednik/historical-basemaps
// (github.com/aourednik/historical-basemaps, geojson/ directory), hardcoded
// since it's small and stable — avoids depending on GitHub's API/rate limits
// at import time just to discover file names.
const FILES = [
  'world_100.geojson', 'world_1000.geojson', 'world_1100.geojson', 'world_1200.geojson',
  'world_1279.geojson', 'world_1300.geojson', 'world_1400.geojson', 'world_1492.geojson',
  'world_1500.geojson', 'world_1530.geojson', 'world_1600.geojson', 'world_1650.geojson',
  'world_1700.geojson', 'world_1715.geojson', 'world_1783.geojson', 'world_1800.geojson',
  'world_1815.geojson', 'world_1880.geojson', 'world_1900.geojson', 'world_1914.geojson',
  'world_1920.geojson', 'world_1930.geojson', 'world_1938.geojson', 'world_1945.geojson',
  'world_1960.geojson', 'world_1994.geojson', 'world_200.geojson', 'world_2000.geojson',
  'world_2010.geojson', 'world_300.geojson', 'world_400.geojson', 'world_500.geojson',
  'world_600.geojson', 'world_700.geojson', 'world_800.geojson', 'world_900.geojson',
  'world_bc1.geojson', 'world_bc100.geojson', 'world_bc1000.geojson', 'world_bc10000.geojson',
  'world_bc123000.geojson', 'world_bc1500.geojson', 'world_bc200.geojson', 'world_bc2000.geojson',
  'world_bc300.geojson', 'world_bc3000.geojson', 'world_bc323.geojson', 'world_bc400.geojson',
  'world_bc4000.geojson', 'world_bc500.geojson', 'world_bc5000.geojson', 'world_bc700.geojson',
  'world_bc8000.geojson',
]

function fileToYear(file) {
  const match = /^world_(bc)?(\d+)\.geojson$/.exec(file)
  if (!match) return null
  const [, bc, digits] = match
  const year = parseInt(digits, 10)
  return bc ? -year : year
}

export const ERAS = FILES.map((file) => ({ file, year: fileToYear(file) })).sort((a, b) => a.year - b.year)

export function nearestEra(year) {
  let best = ERAS[0]
  for (const era of ERAS) {
    if (Math.abs(era.year - year) < Math.abs(best.year - year)) best = era
  }
  return best
}
