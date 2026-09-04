import { describe, it, expect } from 'vitest'
import { UNIT_IN_MM, toMm, fromMm, formatLength } from './unitConversion'

describe('unitConversion', () => {
  it('has the standard scale table', () => {
    expect(UNIT_IN_MM).toEqual({ mm: 1, cm: 10, m: 1000, in: 25.4 })
  })

  it('converts to and from mm', () => {
    expect(toMm(5, 'cm')).toBe(50)
    expect(toMm(1, 'in')).toBeCloseTo(25.4)
    expect(fromMm(50, 'cm')).toBe(5)
    expect(fromMm(25.4, 'in')).toBeCloseTo(1)
  })

  it('round-trips', () => {
    for (const u of ['mm', 'cm', 'm', 'in'] as const) {
      expect(fromMm(toMm(12.5, u), u)).toBeCloseTo(12.5)
    }
  })

  it('formats with trimmed decimals and a unit suffix', () => {
    expect(formatLength(100, 'mm')).toBe('100 mm')
    expect(formatLength(3.937, 'in')).toBe('3.94 in')
    expect(formatLength(2.5, 'cm')).toBe('2.5 cm')
    expect(formatLength(Number.NaN, 'mm')).toBe('—')
  })
})
