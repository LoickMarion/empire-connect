// Downloads the Historic County Borders Project's UK "Definition A" boundaries (92 historic
// counties incl. Northern Ireland; simplified, WGS84) and converts them to GeoJSON.
// Data: https://www.county-borders.co.uk  (free for any use; credit requested, see MapView).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

const DIR = path.join(new URL('../../data/raw/historic-counties/', import.meta.url).pathname)
const URL_ZIP = 'https://www.county-borders.co.uk/UKDefinitionA_WG84_Simplified.zip'
const OUT = path.join(DIR, 'counties.geojson')

try {
  await fs.access(OUT)
  console.log('already have counties.geojson')
} catch {
  await fs.mkdir(DIR, { recursive: true })
  const zip = path.join(DIR, 'defA.zip')
  const res = await fetch(URL_ZIP)
  if (!res.ok) throw new Error(`historic counties: HTTP ${res.status}`)
  await fs.writeFile(zip, Buffer.from(await res.arrayBuffer()))
  execFileSync('unzip', ['-o', '-q', zip, '-d', path.join(DIR, 'defA')])
  execFileSync('npx', ['mapshaper', '-i', path.join(DIR, 'defA/UKDefinitionA.shp'), '-proj', 'wgs84', '-o', 'format=geojson', OUT], { stdio: 'inherit' })
}
