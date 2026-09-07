import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  fibonacciSphere,
  computeBestOrientation,
  AUTO_ORIENT_CANDIDATES,
  AUTO_ORIENT_MAX_FACES,
} from './autoOrient'

/** Two triangles forming a quad, tilted `deg` from horizontal about the X axis,
 *  so the underside faces down at `deg` from straight down. */
function tiltedPlate(deg: number): Float32Array {
  const t = (deg * Math.PI) / 180
  const dy = Math.sin(t) * 10
  const dz = Math.cos(t) * 10
  // corners: (0,0,0) (10,0,0) (10,dy,dz) (0,dy,dz)
  const a = [0, 0, 0], b = [10, 0, 0], c = [10, dy, dz], d = [0, dy, dz]
  return new Float32Array([...a, ...b, ...c, ...a, ...c, ...d])
}

describe('fibonacciSphere', () => {
  it('returns n unit vectors', () => {
    const pts = fibonacciSphere(64)
    expect(pts.length).toBe(64)
    for (const [x, y, z] of pts) {
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5)
    }
  })
})

describe('computeBestOrientation', () => {
  it('leaves a level plate alone (identity quaternion, no-op)', () => {
    const level = tiltedPlate(0)
    const r = computeBestOrientation(level, 45)
    expect(r.skipped).toBe(false)
    // already flat: winner is the current orientation -> identity
    expect(r.quaternion).toEqual([0, 0, 0, 1])
    expect(r.overhangFractionAfter).toBeCloseTo(r.overhangFractionBefore, 5)
  })

  it('finds an orientation that removes the overhang on a tilted plate', () => {
    const tilted = tiltedPlate(30) // underside 30 deg from straight down -> overhang at threshold 45
    const r = computeBestOrientation(tilted, 45)
    expect(r.skipped).toBe(false)
    expect(r.overhangFractionBefore).toBeGreaterThan(0.4) // most of the area is the tilted underside
    expect(r.overhangFractionAfter).toBeLessThan(r.overhangFractionBefore)
    // Applying the returned quaternion should bring the winning face near level.
    const q = new THREE.Quaternion(...r.quaternion)
    // rotate the tilted plate's first-face normal and check it is closer to +-Y
    const n = new THREE.Vector3(0, -Math.cos((30 * Math.PI) / 180), Math.sin((30 * Math.PI) / 180)).applyQuaternion(q)
    expect(Math.abs(n.y)).toBeGreaterThan(0.9)
  })

  it('skips a model over the face cap', () => {
    // AUTO_ORIENT_MAX_FACES + 1 degenerate-free triangles
    const faces = AUTO_ORIENT_MAX_FACES + 1
    const pos = new Float32Array(faces * 9)
    for (let f = 0; f < faces; f++) {
      const o = f * 9
      pos[o] = 0; pos[o + 1] = 0; pos[o + 2] = 0
      pos[o + 3] = 1; pos[o + 4] = 0; pos[o + 5] = 0
      pos[o + 6] = 0; pos[o + 7] = 1; pos[o + 8] = 0
    }
    const r = computeBestOrientation(pos, 45)
    expect(r.skipped).toBe(true)
    expect(r.quaternion).toEqual([0, 0, 0, 1])
    expect(r.candidatesEvaluated).toBe(0)
    expect(Number.isFinite(r.overhangFractionBefore)).toBe(true)
  })

  it('evaluates the Fibonacci sweep, the face-normal candidates, and the current orientation', () => {
    const r = computeBestOrientation(tiltedPlate(10), 45)
    // fibonacci sweep + at least one face-normal candidate + the current orientation
    expect(r.candidatesEvaluated).toBeGreaterThan(AUTO_ORIENT_CANDIDATES + 1)
  })
})
