import { describe, it, expect } from 'vitest'
import {
  SCALE_FACTOR_BOUNDS,
  isFactorInBounds,
  scaleToTargetFactor,
  scaleToFitFactor,
} from './scaleMath'

describe('scaleMath', () => {
  it('exposes the factor bounds', () => {
    expect(SCALE_FACTOR_BOUNDS).toEqual({ min: 1e-4, max: 1e4 })
  })

  it('validates factors', () => {
    expect(isFactorInBounds(1)).toBe(true)
    expect(isFactorInBounds(0)).toBe(false)
    expect(isFactorInBounds(-2)).toBe(false)
    expect(isFactorInBounds(1e5)).toBe(false)
    expect(isFactorInBounds(Number.NaN)).toBe(false)
  })

  it('computes scale-to-target', () => {
    expect(scaleToTargetFactor(50, 100)).toBe(2)
    expect(scaleToTargetFactor(0, 100)).toBeNaN()
    expect(scaleToTargetFactor(50, 0)).toBeNaN()
  })

  it('computes scale-to-fit from the limiting axis', () => {
    const f = scaleToFitFactor({ width: 100, height: 50, depth: 25 }, { x: 200, y: 200, z: 200 })
    // width is limiting: 200/100 = 2, shaved slightly to stay strictly inside the plate
    expect(f).toBeCloseTo(2, 5)
    expect(f).toBeLessThan(2)
    expect(scaleToFitFactor({ width: 0, height: 1, depth: 1 }, { x: 1, y: 1, z: 1 })).toBeNaN()
  })
})
