// Downloads every border snapshot from aourednik/historical-basemaps (the files, not the
// whole ~130MB repo) into data/raw/borders for the province occupation step.
import fs from 'node:fs/promises'
import path from 'node:path'
import { ERAS } from './lib/eras.mjs'

const RAW_URL = 'https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson'
const RAW_DIR = new URL('../../data/raw/', import.meta.url)
const BORDERS_RAW_DIR = path.join(new URL(RAW_DIR).pathname, 'borders')

async function main() {
  // Every snapshot is needed: provinces sample all of them to build their occupation record.
  // The 123000 BCE one is a placeholder map, not a useful occupation record, so skip it.
  const neededFiles = new Map(ERAS.filter((era) => era.year >= -10000).map((era) => [era.file, era.year]))
  console.log(`${neededFiles.size} era snapshots needed`)

  await fs.mkdir(BORDERS_RAW_DIR, { recursive: true })

  const index = []
  for (const [file, eraYear] of neededFiles) {
    const dest = path.join(BORDERS_RAW_DIR, file)
    try {
      await fs.access(dest)
      console.log(`already have ${file}, skipping download`)
    } catch {
      console.log(`downloading ${file}...`)
      const res = await fetch(`${RAW_URL}/${file}`)
      if (!res.ok) throw new Error(`failed to fetch ${file}: ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      await fs.writeFile(dest, buf)
    }
    index.push({ file, eraYear })
  }

  await fs.writeFile(path.join(BORDERS_RAW_DIR, 'index.json'), JSON.stringify(index, null, 2))
  console.log(`wrote ${index.length} border era files to ${BORDERS_RAW_DIR}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
