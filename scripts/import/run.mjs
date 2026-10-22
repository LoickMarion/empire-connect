// Orchestrates the full data pipeline: npm run import-data
import { execFileSync } from 'node:child_process'

const STEPS = [
  'import/01-fetch-wikidata-cities.mjs', // historic cities; they win province-city selection
  'import/03-fetch-borders.mjs',
  'provinces/00-fetch-historic-counties.mjs',
  'provinces/00-fetch-german-districts.mjs',
  'provinces/01-generate-provinces.mjs',
  'provinces/02-assign-cities-and-occupation.mjs',
  'provinces/03-build-outputs.mjs',
]

for (const step of STEPS) {
  console.log(`\n=== ${step} ===`)
  execFileSync('node', [new URL(`../${step}`, import.meta.url).pathname], { stdio: 'inherit' })
}
