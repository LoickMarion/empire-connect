// Downloads only the border-snapshot years actually needed to cover the
// holdings data's date range, from aourednik/historical-basemaps, rather than
// cloning the whole ~130MB repo.
import fs from 'node:fs/promises'
import path from 'node:path'
import { nearestEra } from './lib/eras.mjs'

const RAW_URL = 'https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson'
const RAW_DIR = new URL('../../data/raw/', import.meta.url)
const HOLDINGS_FILE = path.join(new URL(RAW_DIR).pathname, 'holdings.json')
const BORDERS_RAW_DIR = path.join(new URL(RAW_DIR).pathname, 'borders')

async function main() {
  const holdings = JSON.parse(await fs.readFile(HOLDINGS_FILE, 'utf8'))

  const years = new Set()
  for (const h of holdings) {
    years.add(h.start)
    years.add(h.end)
  }

  const neededFiles = new Map() // file -> era year
  for (const year of years) {
    const era = nearestEra(year)
    neededFiles.set(era.file, era.year)
  }

  console.log(`${years.size} distinct holding years -> ${neededFiles.size} era snapshots needed`)

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
