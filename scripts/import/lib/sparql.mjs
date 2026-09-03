const ENDPOINT = 'https://query.wikidata.org/sparql'

// Wikidata's SPARQL service asks that automated clients identify themselves.
const USER_AGENT = 'empire-connect-import/0.1 (https://github.com/; hobby project data import script)'

const MAX_ATTEMPTS = 5

async function retryable(attempt, status, message) {
  if (attempt >= MAX_ATTEMPTS) return false
  const delay = 2000 * 2 ** (attempt - 1)
  console.warn(`SPARQL ${status}, retrying in ${delay}ms (attempt ${attempt}/${MAX_ATTEMPTS}): ${message}`)
  await sleep(delay)
  return true
}

export async function sparql(query, attempt = 1) {
  const url = `${ENDPOINT}?query=${encodeURIComponent(query)}&format=json`
  let res
  try {
    res = await fetch(url, {
      headers: {
        Accept: 'application/sparql-results+json',
        'User-Agent': USER_AGENT,
      },
    })
  } catch (err) {
    // network-level failure (reset, timeout, etc)
    if (await retryable(attempt, 'network', err.message)) return sparql(query, attempt + 1)
    throw err
  }

  if (!res.ok) {
    // The public endpoint occasionally returns transient 429/502/503/504s under load.
    if ([429, 502, 503, 504].includes(res.status) && (await retryable(attempt, res.status, res.statusText))) {
      return sparql(query, attempt + 1)
    }
    throw new Error(`SPARQL query failed: ${res.status} ${res.statusText}\n${await res.text()}`)
  }

  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch (err) {
    // Occasionally the response body gets truncated mid-transfer for large
    // result sets; a plain retry usually succeeds.
    if (await retryable(attempt, 'truncated-response', err.message)) return sparql(query, attempt + 1)
    throw err
  }
  return json.results.bindings
}

export function qidFromUri(uri) {
  if (!uri) return null
  return uri.split('/').pop()
}

export function parseYear(wikidataTimeString) {
  // Wikidata time literals look like "+1453-05-29T00:00:00Z" or "-0146-01-01T00:00:00Z".
  // Values surfaced via pq:/ps: (rather than the raw wikibase:timeValue) are plain
  // xsd:dateTime with no leading sign at all when the year is CE, e.g. "1913-05-30T00:00:00Z".
  if (!wikidataTimeString) return null
  const match = /^([+-]?)(\d+)-/.exec(wikidataTimeString)
  if (!match) return null
  const [, sign, digits] = match
  const year = parseInt(digits, 10)
  return sign === '-' ? -year : year
}

export function parseCoord(pointLiteral) {
  // "Point(28.9784 41.0082)" -> { lon: 28.9784, lat: 41.0082 }
  const match = /^Point\(([-\d.]+)\s+([-\d.]+)\)$/.exec(pointLiteral || '')
  if (!match) return null
  return { lon: parseFloat(match[1]), lat: parseFloat(match[2]) }
}

export async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
