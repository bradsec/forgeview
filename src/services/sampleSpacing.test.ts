import { describe, expect, it } from 'vitest'
import { sampleSpacing } from './sampleSpacing'

describe('sampleSpacing', () => {
  it('matches the longest axis divided by resolution', () => {
    expect(sampleSpacing([80, 40, 20], 32)).toBe(2.5)
    expect(sampleSpacing([40, 80, 20], 64)).toBe(1.25)
  })
  it('keeps service math for zero and unknown bounds', () => {
    expect(sampleSpacing([0, 0, 0], 32)).toBe(0)
    expect(sampleSpacing([80, NaN, 20], 32)).toBeNaN()
  })
})
