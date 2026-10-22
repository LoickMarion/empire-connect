// Breadth-first solver for the connect-the-provinces game. Pure logic, no React or data-source
// dependency, so the UI and scripts/solve.mjs share it.
//
// The game graph: two provinces are adjacent when some nation (or colony/overlord realm, see
// realms.js) held both over overlapping years. Peoples and cultures (isNation === false) never
// connect anything. A solution is a path of provinces; the shortest ones are what the game asks for.
export const CONTINENTS = ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania']

// holdings: [{ city, empireId, nation, start, end, isNation, via? }], already expanded with realms.
export function createGraph(holdings) {
  const byEmpire = new Map()
  const byCity = new Map()
  for (const h of holdings) {
    if (h.isNation === false) continue
    if (!byEmpire.has(h.empireId)) byEmpire.set(h.empireId, [])
    byEmpire.get(h.empireId).push(h)
    if (!byCity.has(h.city)) byCity.set(h.city, [])
    byCity.get(h.city).push(h)
  }
  const cache = new Map()

  // Provinces adjacent to `city`, computed on first use.
  function neighbors(city) {
    let list = cache.get(city)
    if (!list) {
      const seen = new Set()
      for (const h of byCity.get(city) ?? []) {
        for (const o of byEmpire.get(h.empireId)) {
          if (o.city !== city && o.start <= h.end && h.start <= o.end) seen.add(o.city)
        }
      }
      list = [...seen]
      cache.set(city, list)
    }
    return list
  }

  return {
    neighbors,
    has: (city) => byCity.has(city),
    // every way two provinces connect, as pathValidator.findConnections would list them, but
    // looked up through the per-province index so it stays fast inside searches
    connections: (a, b) => {
      const out = []
      if (a === b) return out
      for (const x of byCity.get(a) ?? []) {
        for (const y of byCity.get(b) ?? []) {
          if (x.empireId !== y.empireId) continue
          const overlapStart = Math.max(x.start, y.start)
          const overlapEnd = Math.min(x.end, y.end)
          if (overlapStart > overlapEnd) continue
          const connection = { nation: x.nation, empireId: x.empireId, overlapStart, overlapEnd }
          if (x.via) connection.viaA = x.via
          if (y.via) connection.viaB = y.via
          out.push(connection)
        }
      }
      return out
    },
  }
}

// Hop counts from `start` to every province within `maxDepth` steps.
export function bfsDistances(graph, start, maxDepth = Infinity) {
  const dist = new Map([[start, 0]])
  let frontier = [start]
  for (let d = 1; frontier.length && d <= maxDepth; d += 1) {
    const next = []
    for (const u of frontier) {
      for (const v of graph.neighbors(u)) {
        if (!dist.has(v)) {
          dist.set(v, d)
          next.push(v)
        }
      }
    }
    frontier = next
  }
  return dist
}

// All shortest paths from start to target, or a random sample of them when there are more than
// `sample`. Returns { distance, total, paths } (total = how many shortest paths exist), or null if
// the target can't be reached.
export function shortestPaths(graph, start, target, { sample = 400, rng = Math.random } = {}) {
  if (start === target) return { distance: 0, total: 1, paths: [[start]] }
  const fromStart = bfsDistances(graph, start)
  if (!fromStart.has(target)) return null
  const distance = fromStart.get(target)
  const toTarget = bfsDistances(graph, target, distance)

  // Number of shortest-path completions from each province on a shortest path to the target.
  const onPath = (v) => fromStart.get(v) !== undefined && toTarget.get(v) !== undefined && fromStart.get(v) + toTarget.get(v) === distance
  const nextSteps = (v) => graph.neighbors(v).filter((w) => onPath(w) && fromStart.get(w) === fromStart.get(v) + 1)
  const completions = new Map([[target, 1]])
  const layers = Array.from({ length: distance + 1 }, () => [])
  for (const [v] of fromStart) if (onPath(v)) layers[fromStart.get(v)].push(v)
  for (let i = distance - 1; i >= 0; i -= 1) {
    for (const v of layers[i]) completions.set(v, nextSteps(v).reduce((sum, w) => sum + (completions.get(w) ?? 0), 0))
  }
  const total = completions.get(start)

  const paths = []
  if (total <= sample) {
    const walk = (path) => {
      const last = path[path.length - 1]
      if (last === target) return void paths.push(path)
      for (const w of nextSteps(last)) walk([...path, w])
    }
    walk([start])
  } else {
    // uniform random sample: at each step pick the next province in proportion to its completions
    for (let n = 0; n < sample; n += 1) {
      const path = [start]
      while (path[path.length - 1] !== target) {
        const options = nextSteps(path[path.length - 1])
        let r = rng() * options.reduce((s, w) => s + completions.get(w), 0)
        let chosen = options[options.length - 1]
        for (const w of options) {
          r -= completions.get(w)
          if (r <= 0) {
            chosen = w
            break
          }
        }
        path.push(chosen)
      }
      paths.push(path)
    }
  }
  return { distance, total, paths }
}

// What makes a path "different": the provinces in the middle, the countries they are in, and the
// nation that links each hop (its longest-overlap connection). Used to choose varied answers.
function longestConnection(options) {
  return options.reduce((best, c) => (!best || c.overlapEnd - c.overlapStart > best.overlapEnd - best.overlapStart ? c : best), null)
}

export function pathFeatures(graph, path, countryOf = () => null) {
  const features = new Set()
  path.slice(1, -1).forEach((city) => {
    features.add(`p:${city}`)
    const country = countryOf(city)
    if (country) features.add(`c:${country}`)
  })
  for (let i = 0; i + 1 < path.length; i += 1) {
    const best = longestConnection(graph.connections(path[i], path[i + 1]))
    if (best) features.add(`n:${best.empireId}`)
  }
  return features
}

const FEATURE_WEIGHT = { n: 4, c: 2, p: 1 } // a new linking nation counts most, then a new country

// Up to k paths that differ from each other as much as possible. The first is the most typical
// route (built from the features shared by most shortest paths); each next one adds the most new
// provinces, countries and linking nations. `countryOf(city)` is optional.
export function diversePaths(paths, k = 3, graph = null, countryOf = () => null) {
  const unique = [...new Map(paths.map((p) => [p.join('>'), p])).values()]
  if (unique.length <= k) return unique
  const features = new Map(unique.map((p) => [p, graph ? pathFeatures(graph, p, countryOf) : new Set(p.slice(1, -1).map((c) => `p:${c}`))]))
  const frequency = new Map()
  for (const f of features.values()) for (const x of f) frequency.set(x, (frequency.get(x) ?? 0) + 1)
  const weight = (x) => FEATURE_WEIGHT[x[0]] ?? 1
  const chosen = []
  const covered = new Set()
  while (chosen.length < k) {
    let best = null
    for (const p of unique) {
      if (chosen.includes(p)) continue
      let score = 0
      for (const x of features.get(p)) {
        if (chosen.length === 0) score += (weight(x) * frequency.get(x)) / unique.length
        else if (!covered.has(x)) score += weight(x) * 1000
        else score -= (weight(x) * frequency.get(x)) / unique.length // among ties prefer rarer provinces
      }
      if (!best || score > best.score) best = { p, score }
    }
    chosen.push(best.p)
    for (const x of features.get(best.p)) covered.add(x)
  }
  return chosen
}

// Pick the connection to show for each hop. Prefer a nation no earlier hop in any shown solution
// has used, so the answers read differently; otherwise the longest overlap.
export function describePaths(graph, paths) {
  const usedNations = new Set()
  return paths.map((path) => {
    const steps = []
    for (let i = 0; i + 1 < path.length; i += 1) {
      const options = graph.connections(path[i], path[i + 1])
      const longest = (a, b) => b.overlapEnd - b.overlapStart - (a.overlapEnd - a.overlapStart)
      const fresh = options.filter((c) => !usedNations.has(c.nation)).sort(longest)
      const choice = fresh[0] ?? [...options].sort(longest)[0]
      usedNations.add(choice.nation)
      steps.push({ from: path[i], to: path[i + 1], connection: choice })
    }
    return { path, steps }
  })
}

// A start and a target whose shortest connection is between `min` and `max` steps. Picks a distance
// uniformly among those available (so 7-step puzzles aren't rare), then a random pair.
// `provinces`: [{ id, continent }]. Set `differentContinents` to also require the two to be on
// different continents (off by default). Returns { start, target, distance } or null.
export function pickGamePair(graph, provinces, { min = 3, max = 7, tries = 60, rng = Math.random, differentContinents = false } = {}) {
  const pool = differentContinents ? provinces.filter((p) => CONTINENTS.includes(p.continent)) : provinces
  const continentOf = new Map(pool.map((p) => [p.id, p.continent]))
  const ids = [...continentOf.keys()]
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const start = ids[Math.floor(rng() * ids.length)]
    const dist = bfsDistances(graph, start, max)
    const byDistance = new Map()
    for (const [city, d] of dist) {
      if (d < min || d > max || !continentOf.has(city)) continue
      if (differentContinents && continentOf.get(city) === continentOf.get(start)) continue
      if (!byDistance.has(d)) byDistance.set(d, [])
      byDistance.get(d).push(city)
    }
    if (!byDistance.size) continue
    const distances = [...byDistance.keys()]
    const distance = distances[Math.floor(rng() * distances.length)]
    const options = byDistance.get(distance)
    return { start, target: options[Math.floor(rng() * options.length)], distance }
  }
  return null
}
