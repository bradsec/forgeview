import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { computeWallThicknessMask, WALL_THICKNESS_MAX_TRIANGLES } from './wallThickness'

function geo(positions: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  return g
}

describe('computeWallThicknessMask', () => {
  it('exports the triangle cap', () => {
    expect(WALL_THICKNESS_MAX_TRIANGLES).toBe(250_000)
  })

  it('flags both faces of a 0.5-unit slab at min-wall 1.0 mm and neither at 0.2 mm', () => {
    // Top triangle: winding gives normal (0, 1, 0). Bottom triangle at y = -0.5:
    // winding gives normal (0, -1, 0). Each face's inward ray travels 0.5 units
    // to the opposite plane.
    const g = geo([
      0, 0, 0, 1, 0, 1, 1, 0, 0, // top, normal +Y
      0, -0.5, 0, 1, -0.5, 0, 1, -0.5, 1, // bottom, normal -Y
    ])
    expect(computeWallThicknessMask(g, 1.0, 1).thinCount).toBe(2)
    expect(computeWallThicknessMask(g, 0.2, 1).thinCount).toBe(0)
  })

  it('respects unitInMm', () => {
    const g = geo([
      0, 0, 0, 1, 0, 1, 1, 0, 0,
      0, -0.5, 0, 1, -0.5, 0, 1, -0.5, 1,
    ])
    // 0.5 units * 10 mm/unit = 5 mm, not thin against a 1 mm minimum
    expect(computeWallThicknessMask(g, 1.0, 10).thinCount).toBe(0)
  })

  it('does not flag a thick 5-unit block', () => {
    const g = geo([
      0, 0, 0, 1, 0, 1, 1, 0, 0,
      0, -5, 0, 1, -5, 0, 1, -5, 1,
    ])
    expect(computeWallThicknessMask(g, 1.0, 1).thinCount).toBe(0)
  })

  it('counts a face whose ray escapes as unsampled', () => {
    const g = geo([0, 0, 0, 1, 0, 1, 1, 0, 0]) // lone triangle, nothing opposite
    const r = computeWallThicknessMask(g, 1.0, 1)
    expect(r.thinCount).toBe(0)
    expect(r.unsampledCount).toBe(1)
  })

  it('skips a degenerate triangle without throwing', () => {
    const g = geo([0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(() => computeWallThicknessMask(g, 1.0, 1)).not.toThrow()
    const r = computeWallThicknessMask(g, 1.0, 1)
    expect(r.thinCount).toBe(0)
    expect(r.unsampledCount).toBe(0)
    expect(r.mask.length).toBe(1)
  })

  it('mask length equals the face count', () => {
    const g = geo([
      0, 0, 0, 1, 0, 1, 1, 0, 0,
      0, -0.5, 0, 1, -0.5, 0, 1, -0.5, 1,
    ])
    expect(computeWallThicknessMask(g, 1.0, 1).mask.length).toBe(2)
  })
})
