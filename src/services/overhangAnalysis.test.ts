import { describe, it, expect } from 'vitest'
import { computeOverhangFaceMask } from './overhangAnalysis'

describe('computeOverhangFaceMask', () => {
  it('flags a straight-down-facing triangle at any positive threshold', () => {
    // Winding (P0,P1,P2) with these positions yields normal (0,-1,0) exactly.
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      1, 0, 1,
    ])
    const { mask, count } = computeOverhangFaceMask(positions, 1)
    expect(Array.from(mask)).toEqual([1])
    expect(count).toBe(1)
  })

  it('never flags a vertical wall triangle', () => {
    // Winding yields normal (1,0,0) — a vertical wall, 90 deg from straight down.
    const positions = new Float32Array([
      0, 0, 0,
      0, 1, 0,
      0, 1, 1,
    ])
    const { mask, count } = computeOverhangFaceMask(positions, 89)
    expect(Array.from(mask)).toEqual([0])
    expect(count).toBe(0)
  })

  it('flags a 30-degree-from-straight-down face only when the threshold exceeds 30', () => {
    // A flat plate rotated 30 deg about X from a straight-down-facing plate.
    // See derivation in the design spec: normal becomes (0, -cos30, -sin30),
    // i.e. angleFromStraightDown = 30 deg exactly.
    const cos30 = Math.cos((30 * Math.PI) / 180)
    const sin30 = Math.sin((30 * Math.PI) / 180)
    const p0 = [0, 0, 0]
    const p1 = [20, 0, 0]
    const p2 = [20, -10 * sin30, 10 * cos30]
    const positions = new Float32Array([...p0, ...p1, ...p2])
    expect(computeOverhangFaceMask(positions, 45).count).toBe(1)
    expect(computeOverhangFaceMask(positions, 15).count).toBe(0)
  })

  it('excludes a degenerate (zero-area) triangle without throwing', () => {
    const positions = new Float32Array([
      0, 0, 0,
      0, 0, 0,
      0, 0, 0,
    ])
    expect(() => computeOverhangFaceMask(positions, 45)).not.toThrow()
    const { mask, count } = computeOverhangFaceMask(positions, 45)
    expect(Array.from(mask)).toEqual([0])
    expect(count).toBe(0)
  })

  it('sums count correctly across multiple faces', () => {
    const down = [0, 0, 0, 1, 0, 0, 1, 0, 1] // normal (0,-1,0)
    const wall = [0, 0, 0, 0, 1, 0, 0, 1, 1] // normal (1,0,0)
    const positions = new Float32Array([...down, ...wall])
    const { mask, count } = computeOverhangFaceMask(positions, 45)
    expect(Array.from(mask)).toEqual([1, 0])
    expect(count).toBe(1)
  })
})
