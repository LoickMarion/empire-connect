import { describe, expect, it } from 'vitest'
import { createColorResolver, lighten } from './colors.js'

const empires = [
  { id: 1, color: '#000000' },
  { id: 2, color: '#ff0000' },
  { id: 3, color: '#0000ff' },
]

describe('colors', () => {
  it('lightens towards white', () => {
    expect(lighten('#000000', 0.5)).toBe('#808080')
  })
  it('draws a subject lighter than its overlord only while linked', () => {
    const colorAt = createColorResolver(empires, [{ occupierId: 2, overlordId: 3, start: 1800, end: 1900, kind: 'subject' }])
    expect(colorAt(2, 1850)).toBe(lighten('#0000ff'))
    expect(colorAt(2, 1950)).toBe('#ff0000')
    expect(colorAt(3, 1850)).toBe('#0000ff')
  })
  it('keeps the realm colour for a member link', () => {
    const colorAt = createColorResolver(empires, [{ occupierId: 2, overlordId: 3, start: 1800, end: 1900, kind: 'member' }])
    expect(colorAt(2, 1850)).toBe('#ff0000')
  })
  it('uses the top overlord of a chain', () => {
    const colorAt = createColorResolver(empires, [
      { occupierId: 1, overlordId: 2, start: 1800, end: 1900, kind: 'subject' },
      { occupierId: 2, overlordId: 3, start: 1800, end: 1900, kind: 'subject' },
      { occupierId: 1, overlordId: 3, start: 1800, end: 1900, kind: 'subject' },
    ])
    expect(colorAt(1, 1850)).toBe(lighten('#0000ff'))
  })
})
