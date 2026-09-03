// Simplifies each downloaded border-era GeoJSON (mapshaper: reduce vertex
// count, keep only the NAME property) and writes the result into
// public/data/borders/, which is what the app fetches at runtime.
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const RAW_BORDERS_DIR = new URL('../../data/raw/borders/', import.meta.url).pathname
const OUT_DIR = new URL('../../public/data/borders/', import.meta.url).pathname

async function main() {
  const indexPath = path.join(RAW_BORDERS_DIR, 'index.json')
  const index = JSON.parse(await fs.readFile(indexPath, 'utf8'))

  await fs.mkdir(OUT_DIR, { recursive: true })

  let totalIn = 0
  let totalOut = 0
  for (const { file } of index) {
    const inPath = path.join(RAW_BORDERS_DIR, file)
    const outPath = path.join(OUT_DIR, file)
    const inStat = await fs.stat(inPath)
    totalIn += inStat.size

    await execFileAsync('npx', [
      'mapshaper',
      inPath,
      '-simplify', '8%',
      '-filter-fields', 'NAME',
      '-o', outPath, 'force',
    ])

    const outStat = await fs.stat(outPath)
    totalOut += outStat.size
    console.log(`${file}: ${(inStat.size / 1024).toFixed(0)}KB -> ${(outStat.size / 1024).toFixed(0)}KB`)
  }

  await fs.writeFile(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2))
  console.log(`total: ${(totalIn / 1024 / 1024).toFixed(1)}MB -> ${(totalOut / 1024 / 1024).toFixed(1)}MB`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
