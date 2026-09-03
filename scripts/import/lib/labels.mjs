// Batched label lookup. SPARQL's SERVICE wikibase:label federated call is very
// slow/times out when combined with a large candidate set in the same query,
// so labels are fetched separately in small VALUES-batches against a known
// list of QIDs, which is cheap.
import { sparql, qidFromUri, sleep } from './sparql.mjs'

const BATCH_SIZE = 200

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function fetchLabels(qids) {
  const labels = new Map()
  for (const batch of chunk([...new Set(qids)], BATCH_SIZE)) {
    const values = batch.map((q) => `wd:${q}`).join(' ')
    const rows = await sparql(`
      SELECT ?entity ?label WHERE {
        VALUES ?entity { ${values} }
        ?entity rdfs:label ?label .
        FILTER(lang(?label) = "en")
      }
    `)
    for (const row of rows) {
      labels.set(qidFromUri(row.entity.value), row.label.value)
    }
    await sleep(300)
  }
  return labels
}

// Wikidata sitelinks count, used as a rough "how notable/well-known is this
// place" proxy for ranking cities against each other (a Balkan village with
// detailed sovereignty-change data but few sitelinks should lose out to
// Paris/Baghdad/Beijing when trimming down to a target count).
export async function fetchSitelinkCounts(qids) {
  const counts = new Map()
  for (const batch of chunk([...new Set(qids)], BATCH_SIZE)) {
    const values = batch.map((q) => `wd:${q}`).join(' ')
    const rows = await sparql(`
      SELECT ?entity ?sitelinks WHERE {
        VALUES ?entity { ${values} }
        ?entity wikibase:sitelinks ?sitelinks .
      }
    `)
    for (const row of rows) {
      counts.set(qidFromUri(row.entity.value), parseInt(row.sitelinks.value, 10))
    }
    await sleep(300)
  }
  return counts
}

// Resolves a list of exact English labels to Wikidata QIDs in one batched
// query (rather than one query per label). Requires a coordinate (P625) so an
// ambiguous label (e.g. "Cairo" also matching a person or disambiguation
// page) resolves to the actual place rather than an arbitrary same-named item.
export async function resolveLabelsToQids(labels) {
  const byLabel = new Map()
  for (const batch of chunk(labels, 60)) {
    const values = batch.map((l) => `"${l.replace(/"/g, '\\"')}"@en`).join(' ')
    const rows = await sparql(`
      SELECT ?label ?entity WHERE {
        VALUES ?label { ${values} }
        ?entity rdfs:label ?label .
        ?entity wdt:P625 ?coord .
      }
    `)
    for (const row of rows) {
      const label = row.label.value
      if (!byLabel.has(label)) byLabel.set(label, qidFromUri(row.entity.value))
    }
    await sleep(300)
  }
  return byLabel
}
