import { describe, it, expect } from 'vitest'
import { createGraph, bfsDistances, shortestPaths, diversePaths, describePaths, pickGamePair } from './solver'

// A chain A - B - C - D - E (each neighbouring pair shares a nation) plus a second route A - X - Y - D.
const h = (city, empireId, start = 0, end = 100, extra = {}) => ({ city, empireId, nation: empireId.toUpperCase(), start, end, isNation: true, ...extra })
const holdings = [
  h('A', 'n1'), h('B', 'n1'),
  h('B', 'n2'), h('C', 'n2'),
  h('C', 'n3'), h('D', 'n3'),
  h('D', 'n4'), h('E', 'n4'),
  h('A', 'n5'), h('X', 'n5'),
  h('X', 'n6'), h('Y', 'n6'),
  h('Y', 'n7'), h('D', 'n7'),
]
const graph = createGraph(holdings)

describe('bfsDistances', () => {
  it('counts hops', () => {
    const d = bfsDistances(graph, 'A')
    expect(d.get('B')).toBe(1)
    expect(d.get('D')).toBe(3)
    expect(d.get('E')).toBe(4)
  })

  it('stops at maxDepth', () => {
    expect(bfsDistances(graph, 'A', 2).has('E')).toBe(false)
  })
})

describe('shortestPaths', () => {
  it('finds every shortest path', () => {
    const result = shortestPaths(graph, 'A', 'D')
    expect(result.distance).toBe(3)
    expect(result.total).toBe(2)
    expect(result.paths.map((p) => p.join('>')).sort()).toEqual(['A>B>C>D', 'A>X>Y>D'])
  })

  it('returns null when unreachable', () => {
    expect(shortestPaths(createGraph([h('A', 'n1'), h('B', 'n9')]), 'A', 'B')).toBeNull()
  })

  it('ignores peoples and cultures', () => {
    const g = createGraph([h('A', 'culture', 0, 10, { isNation: false }), h('B', 'culture', 0, 10, { isNation: false })])
    expect(g.neighbors('A')).toEqual([])
  })

  it('needs the years to overlap', () => {
    const g = createGraph([h('A', 'n', 0, 10), h('B', 'n', 20, 30)])
    expect(g.neighbors('A')).toEqual([])
  })

  it('samples when there are too many paths, still returning only shortest ones', () => {
    // 3 layers of 6 mutually-connected provinces between S and T => 6*6 shortest paths
    const rows = []
    const layer = (k) => Array.from({ length: 6 }, (_, i) => `${k}${i}`)
    layer('a').forEach((c) => rows.push(h('S', `s-${c}`), h(c, `s-${c}`)))
    layer('a').forEach((c, i) => layer('b').forEach((d) => rows.push(h(c, `ab-${c}-${d}`), h(d, `ab-${c}-${d}`))))
    layer('b').forEach((c) => rows.push(h(c, `t-${c}`), h('T', `t-${c}`)))
    const g = createGraph(rows)
    const r = shortestPaths(g, 'S', 'T', { sample: 10 })
    expect(r.distance).toBe(3)
    expect(r.total).toBe(36)
    expect(r.paths).toHaveLength(10)
    expect(r.paths.every((p) => p.length === 4 && p[0] === 'S' && p[3] === 'T')).toBe(true)
  })
})

describe('diversePaths', () => {
  it('prefers routes that share as few provinces as possible', () => {
    const paths = [['S', 'a', 'b', 'T'], ['S', 'a', 'c', 'T'], ['S', 'x', 'y', 'T'], ['S', 'a', 'b', 'T']]
    const picked = diversePaths(paths, 2)
    expect(picked).toHaveLength(2)
    const middles = picked.flatMap((p) => p.slice(1, -1))
    expect(new Set(middles).size).toBe(middles.length) // no province repeated
  })

  it('counts different countries and linking nations as differences, not just provinces', () => {
    // two routes through different provinces of the same country and nation, and one through another country
    const g = createGraph([
      h('S', 'a'), h('m1', 'a'), h('m1', 'b'), h('T', 'b'),
      h('S', 'a2'), h('m2', 'a2'), h('m2', 'b2'), h('T', 'b2'),
      h('S', 'z'), h('m3', 'z'), h('m3', 'y'), h('T', 'y'),
    ])
    const country = { m1: 'X', m2: 'X', m3: 'Y' }
    const picked = diversePaths([['S', 'm1', 'T'], ['S', 'm2', 'T'], ['S', 'm3', 'T']], 2, g, (c) => country[c])
    // whichever is first, the second must not be the other province of the same country
    expect(new Set(picked.map((p) => country[p[1]]))).toEqual(new Set(['X', 'Y']))
  })

  it('returns everything when there are few', () => {
    expect(diversePaths([['A', 'B']], 3)).toEqual([['A', 'B']])
  })
})

describe('describePaths', () => {
  it('uses different nations in different solutions when it can', () => {
    const g = createGraph([h('A', 'x'), h('B', 'x'), h('A', 'y'), h('B', 'y')])
    const [first, second] = describePaths(g, [['A', 'B'], ['A', 'B']])
    expect(first.steps[0].connection.nation).not.toBe(second.steps[0].connection.nation)
  })
})

describe('pickGamePair', () => {
  const rows = []
  const names = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']
  names.slice(0, -1).forEach((c, i) => rows.push(h(c, `n${i}`), h(names[i + 1], `n${i}`)))
  const line = createGraph(rows)
  const provinces = names.map((id, i) => ({ id, continent: i < 5 ? 'Europe' : 'Asia' }))

  it('only needs the distance to be within the limits by default', () => {
    const seen = new Set()
    for (let i = 0; i < 60; i += 1) {
      const pair = pickGamePair(line, provinces, { min: 3, max: 7 })
      expect(bfsDistances(line, pair.start).get(pair.target)).toBe(pair.distance)
      expect(pair.distance).toBeGreaterThanOrEqual(3)
      expect(pair.distance).toBeLessThanOrEqual(7)
      const byId = Object.fromEntries(provinces.map((p) => [p.id, p.continent]))
      seen.add(byId[pair.start] === byId[pair.target])
    }
    expect(seen.has(true)).toBe(true) // same-continent puzzles do occur
  })

  it('can still require different continents when asked', () => {
    for (let i = 0; i < 30; i += 1) {
      const pair = pickGamePair(line, provinces, { min: 3, max: 7, differentContinents: true })
      const byId = Object.fromEntries(provinces.map((p) => [p.id, p.continent]))
      expect(byId[pair.start]).not.toBe(byId[pair.target])
      expect(pair.distance).toBeGreaterThanOrEqual(3)
      expect(pair.distance).toBeLessThanOrEqual(7)
      expect(bfsDistances(line, pair.start).get(pair.target)).toBe(pair.distance)
    }
  })

  it('returns null when nothing fits', () => {
    expect(pickGamePair(line, provinces, { min: 10, max: 12 })).toBeNull()
  })
})
