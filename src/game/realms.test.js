import { describe, it, expect } from 'vitest'
import { expandWithRealms } from './realms'
import { findConnections } from './pathValidator'

const holdings = [
  { city: 'lisbon', empireId: 'portugal', nation: 'Portugal', isNation: true, start: 1200, end: 2025 },
  { city: 'sao-paulo', empireId: 'portuguese-brazil', nation: 'Portuguese Brazil', isNation: true, start: 1650, end: 1714 },
  { city: 'sao-paulo', empireId: 'brazil', nation: 'Brazil', isNation: true, start: 1914, end: 2025 },
]
const links = [{ occupierId: 'portuguese-brazil', overlordId: 'portugal', overlordName: 'Portugal', start: -10000, end: 2025 }]

describe('expandWithRealms', () => {
  it('lets a colony connect to its parent through the parent', () => {
    const result = findConnections('lisbon', 'sao-paulo', expandWithRealms(holdings, links))
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ nation: 'Portugal', overlapStart: 1650, overlapEnd: 1714, viaB: 'Portuguese Brazil' })
  })

  it('does not connect them without the link', () => {
    expect(findConnections('lisbon', 'sao-paulo', holdings)).toEqual([])
  })

  it('only applies while the link is in force (independence ends it)', () => {
    const windowed = [{ occupierId: 'brazil', overlordId: 'portugal', overlordName: 'Portugal', start: 1815, end: 1822 }]
    const result = findConnections('lisbon', 'sao-paulo', expandWithRealms(holdings, windowed))
    expect(result).toEqual([]) // Brazil held 1914+, long after the link ended
  })

  it('links two colonies of the same realm to each other', () => {
    const more = [
      ...holdings,
      { city: 'luanda', empireId: 'portuguese-east-africa', nation: 'Portuguese East Africa', isNation: true, start: 1650, end: 1714 },
    ]
    const both = [...links, { occupierId: 'portuguese-east-africa', overlordId: 'portugal', overlordName: 'Portugal', start: -10000, end: 2025 }]
    expect(findConnections('sao-paulo', 'luanda', expandWithRealms(more, both))[0]).toMatchObject({ nation: 'Portugal' })
  })
})
