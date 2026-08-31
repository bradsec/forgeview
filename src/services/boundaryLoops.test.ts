import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { extractBoundaryLoops, centroidFan } from './boundaryLoops'
import { analyzeGeometry } from './meshHealth'

/** unit cube missing the +Z face: 10 triangles, one square hole */
function openCube(): THREE.BufferGeometry {
  const full = new THREE.BoxGeometry(1, 1, 1).toNonIndexed().getAttribute('position').array as Float32Array
  const keep = new Float32Array([...full.slice(0, 18 * 4), ...full.slice(18 * 5, 18 * 6)])
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(keep, 3))
  return g
}

/** two unit cubes side by side (x and x+2), each missing its +Z face */
function twoOpenCubes(): THREE.BufferGeometry {
  const one = openCube().getAttribute('position').array as Float32Array
  const shifted = Float32Array.from(one)
  for (let i = 0; i < shifted.length; i += 3) shifted[i] += 4
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...one, ...shifted]), 3))
  return g
}

/** two triangle fans sharing one apex: pinched, non-simple boundary */
function figureEightBoundary(): THREE.BufferGeometry {
  const P = [0, 0, 0]
  const a0 = [1, 0, 0], a1 = [1, 1, 0], a2 = [0, 1, 0]
  const b0 = [-1, 0, 0], b1 = [-1, -1, 0], b2 = [0, -1, 0]
  const faces = [[P, a0, a1], [P, a1, a2], [P, b0, b1], [P, b1, b2]]
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(faces.flat(2)), 3))
  return g
}

describe('extractBoundaryLoops', () => {
  it('finds one 4-vertex loop for an open cube', () => {
    const { loops, skippedPinched } = extractBoundaryLoops(openCube())
    expect(loops.length).toBe(1)
    expect(loops[0].vertexCount).toBe(4)
    expect(skippedPinched).toBe(0)
    // every loop point sits on the +Z rim
    for (const [, , z] of loops[0].points) expect(z).toBeCloseTo(0.5)
  })

  it('finds two separate loops for two open cubes', () => {
    const { loops } = extractBoundaryLoops(twoOpenCubes())
    expect(loops.length).toBe(2)
    expect(loops.every((l) => l.vertexCount === 4)).toBe(true)
  })

  it('returns no loops and counts the pinched component', () => {
    const { loops, skippedPinched } = extractBoundaryLoops(figureEightBoundary())
    expect(loops.length).toBe(0)
    expect(skippedPinched).toBe(1)
  })

  it('returns nothing for a closed cube', () => {
    const { loops, skippedPinched } = extractBoundaryLoops(new THREE.BoxGeometry(1, 1, 1))
    expect(loops.length).toBe(0)
    expect(skippedPinched).toBe(0)
  })
})

describe('centroidFan', () => {
  it('caps a square loop with 4 triangles that seal it watertight', () => {
    const src = openCube()
    const { loops } = extractBoundaryLoops(src)
    const fan = centroidFan(loops[0].points)
    expect(fan.length).toBe(4 * 9)
    const soup = src.toNonIndexed().getAttribute('position').array as Float32Array
    const sealed = new THREE.BufferGeometry()
    sealed.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...soup, ...fan]), 3))
    const after = analyzeGeometry(sealed)
    expect(after.boundaryEdges).toBe(0)
    expect(after.watertight).toBe(true)
    expect(after.triangles).toBe(14)

    // verify fan triangles face outward: compute mesh centroid, then for each
    // fan triangle assert that its normal dots positive with the vector from
    // mesh centroid to face centroid.
    const allPos = sealed.getAttribute('position').array as Float32Array
    let meshC: [number, number, number] = [0, 0, 0]
    for (let i = 0; i < allPos.length; i += 3) {
      meshC[0] += allPos[i]; meshC[1] += allPos[i + 1]; meshC[2] += allPos[i + 2]
    }
    meshC[0] /= allPos.length / 3; meshC[1] /= allPos.length / 3; meshC[2] /= allPos.length / 3

    // fan triangles are the last 4 in allPos
    for (let ti = 0; ti < 4; ti++) {
      const v0i = (soup.length / 3 + ti * 3) * 3 // centroid
      const v1i = v0i + 3 // b
      const v2i = v0i + 6 // a
      const v0: [number, number, number] = [allPos[v0i], allPos[v0i + 1], allPos[v0i + 2]]
      const v1: [number, number, number] = [allPos[v1i], allPos[v1i + 1], allPos[v1i + 2]]
      const v2: [number, number, number] = [allPos[v2i], allPos[v2i + 1], allPos[v2i + 2]]
      const e1: [number, number, number] = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]]
      const e2: [number, number, number] = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]]
      const normal: [number, number, number] = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ]
      const faceC: [number, number, number] = [
        (v0[0] + v1[0] + v2[0]) / 3,
        (v0[1] + v1[1] + v2[1]) / 3,
        (v0[2] + v1[2] + v2[2]) / 3,
      ]
      const toFace: [number, number, number] = [faceC[0] - meshC[0], faceC[1] - meshC[1], faceC[2] - meshC[2]]
      const dot = normal[0] * toFace[0] + normal[1] * toFace[1] + normal[2] * toFace[2]
      expect(dot).toBeGreaterThan(0)
    }
  })
})
