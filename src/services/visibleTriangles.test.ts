import { describe, expect, it } from 'vitest'
import { viewDirections, visibleTriangleFlags } from './visibleTriangles'

describe('viewDirections', () => {
  it('provides 42 unit-length directions covering the sphere', () => {
    const directions = viewDirections()
    expect(directions.length).toBe(42)
    for (const direction of directions) {
      expect(direction.length()).toBeCloseTo(1, 5)
    }
    // Directions must cover both hemispheres of every axis.
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(directions.some((direction) => direction[axis] > 0.5)).toBe(true)
      expect(directions.some((direction) => direction[axis] < -0.5)).toBe(true)
    }
  })
})

describe('visibleTriangleFlags', () => {
  it('returns null without WebGL instead of throwing', () => {
    // jsdom has no WebGL context; the classification must fall back cleanly.
    const soup = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
    expect(visibleTriangleFlags(soup)).toBeNull()
  })

  it('handles an empty soup', () => {
    expect(visibleTriangleFlags(new Float32Array(0))?.length).toBe(0)
  })
})
