// Downloads Germany's 401 districts (Kreise) from Eurostat GISCO (NUTS 3, 2021, 1:3M) and keeps
// the German ones. Open licence, attribution required: "© EuroGeographics for the administrative
// boundaries" (credited in MapView).
import fs from 'node:fs/promises'
import path from 'node:path'

const DIR = new URL('../../data/raw/germany/', import.meta.url).pathname
const OUT = path.join(DIR, 'districts.geojson')
const URL_NUTS3 = 'https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_03M_2021_4326_LEVL_3.geojson'

try {
  await fs.access(OUT)
  console.log('already have districts.geojson')
} catch {
  await fs.mkdir(DIR, { recursive: true })
  const res = await fetch(URL_NUTS3)
  if (!res.ok) throw new Error(`NUTS3: HTTP ${res.status}`)
  const all = await res.json()
  const features = all.features.filter((f) => f.properties.CNTR_CODE === 'DE')
  await fs.writeFile(OUT, JSON.stringify({ type: 'FeatureCollection', features }))
  console.log(`${features.length} German districts`)
}
