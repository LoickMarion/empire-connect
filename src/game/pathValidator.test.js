import { describe, it, expect } from 'vitest'
import { findConnections, canConnect } from './pathValidator'

const holdings = [
  { nation: 'Roman Empire', empireId: 'roman-empire', city: 'rome', start: -27, end: 476 },
  { nation: 'Roman Empire', empireId: 'roman-empire', city: 'london', start: 43, end: 410 },
  { nation: 'Ottoman Empire', empireId: 'ottoman-empire', city: 'sofia', start: 1396, end: 1878 },
  { nation: 'Ottoman Empire', empireId: 'ottoman-empire', city: 'belgrade', start: 1521, end: 1867 },
  { nation: 'Habsburg Monarchy', empireId: 'habsburg-monarchy', city: 'vienna', start: 1526, end: 1918 },
  { nation: 'Napoleonic French Empire', empireId: 'napoleonic-french-empire', city: 'paris', start: 1804, end: 1814 },
]

describe('findConnections', () => {
  it('finds a nation that held both cities with overlapping ranges', () => {
    const result = findConnections('rome', 'london', holdings)
    expect(result).toEqual([
      { nation: 'Roman Empire', empireId: 'roman-empire', overlapStart: 43, overlapEnd: 410 },
    ])
  })

  it('finds multiple overlapping nations if applicable', () => {
    const extra = [
      ...holdings,
      { nation: 'Some Other Empire', empireId: 'some-other-empire', city: 'rome', start: 0, end: 100 },
      { nation: 'Some Other Empire', empireId: 'some-other-empire', city: 'london', start: 50, end: 200 },
    ]
    const result = findConnections('rome', 'london', extra)
    expect(result).toHaveLength(2)
  })

  it('returns empty when nations never held both cities simultaneously', () => {
    // vienna (Habsburg 1526-1918) vs sofia (Ottoman 1396-1878) - different nations
    expect(findConnections('vienna', 'sofia', holdings)).toEqual([])
  })

  it('returns empty when the same nation held both but ranges do not overlap', () => {
    const nonOverlapping = [
      { nation: 'X', empireId: 'x', city: 'a', start: 0, end: 100 },
      { nation: 'X', empireId: 'x', city: 'b', start: 200, end: 300 },
    ]
    expect(findConnections('a', 'b', nonOverlapping)).toEqual([])
  })

  it('returns empty for a city connected to itself', () => {
    expect(findConnections('rome', 'rome', holdings)).toEqual([])
  })

  it('treats different empire ids with the same display name as distinct', () => {
    const sameName = [
      { nation: 'Duplicate Name Empire', empireId: 'dup-1', city: 'a', start: 0, end: 100 },
      { nation: 'Duplicate Name Empire', empireId: 'dup-2', city: 'b', start: 0, end: 100 },
    ]
    expect(findConnections('a', 'b', sameName)).toEqual([])
  })
})

describe('canConnect', () => {
  it('is true when a connection exists', () => {
    expect(canConnect('sofia', 'belgrade', holdings)).toBe(true)
  })

  it('is false when no connection exists', () => {
    expect(canConnect('paris', 'sofia', holdings)).toBe(false)
  })
})
