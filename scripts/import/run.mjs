// Orchestrates the full import pipeline: npm run import-data
import { execFileSync } from 'node:child_process'

const STEPS = [
  '01-fetch-wikidata-cities.mjs',
  '02-fetch-wikidata-holdings.mjs',
  '03-fetch-borders.mjs',
  '04-simplify-borders.mjs',
  '05-build-sqlite.mjs',
]

for (const step of STEPS) {
  console.log(`\n=== ${step} ===`)
  execFileSync('node', [new URL(step, import.meta.url).pathname], { stdio: 'inherit' })
}
