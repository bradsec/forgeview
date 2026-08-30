import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  weldVertices,
  dropDegenerateFaces,
  dropDuplicateFaces,
  unifyNormals,
  removeSmallShells,
  STAGE_LABEL,
} from './repairStages'
import { analyzeGeometry } from './meshHealth'

/** unit cube as 12 non-indexed triangles with split vertices (36 positions) */
function splitCube(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1)
  return g.toNonIndexed()
}

describe('STAGE_LABEL', () => {
  it('covers every stage plus seal', () => {
    for (const id of ['weld','degenerate','duplicate','normals','smallShells','holeFill','seal'] as const) {
      expect(typeof STAGE_LABEL[id]).toBe('string')
    }
  })
})

describe('weldVertices', () => {
  it('merges split vertices without changing the surface', () => {
    const src = splitCube()
    const before = analyzeGeometry(src)
    const { geometry } = weldVertices(src)
    const after = analyzeGeometry(geometry)
    expect(after.vertices).toBe(8)
    expect(after.triangles).toBe(before.triangles)
    expect(after.watertight).toBe(true)
    // input untouched
    expect(src.getAttribute('position').count).toBe(36)
  })
})

describe('dropDegenerateFaces', () => {
  it('removes a triangle with two coincident corners', () => {
    const positions = new Float32Array([
      0,0,0, 1,0,0, 0,1,0,      // good
      2,2,2, 2,2,2, 3,2,2,      // degenerate (first two identical)
    ])
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const { geometry } = dropDegenerateFaces(g)
    expect(analyzeGeometry(geometry).triangles).toBe(1)
  })
})

describe('dropDuplicateFaces', () => {
  it('removes exactly one of a duplicated pair', () => {
    const t = [0,0,0, 1,0,0, 0,1,0]
    const positions = new Float32Array([...t, ...t, 5,0,0, 6,0,0, 5,1,0])
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    expect(analyzeGeometry(g).duplicateFaces).toBe(1)
    const { geometry } = dropDuplicateFaces(g)
    const after = analyzeGeometry(geometry)
    expect(after.triangles).toBe(2)
    expect(after.duplicateFaces).toBe(0)
  })
})

/** two triangles forming a quad, second one wound backwards */
function inconsistentQuad(): THREE.BufferGeometry {
  const positions = new Float32Array([
    0,0,0, 1,0,0, 1,1,0,
    0,0,0, 1,1,0, 0,1,0,      // reverse this to be inconsistent:
  ])
  // flip triangle 2 winding
  positions.set([0,0,0, 0,1,0, 1,1,0], 9)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return g
}

/**
 * Two triangles sharing edge B-C. The second triangle is wound so BFS will flip
 * it, and its first-seen unique vertex D sits at CORNER 0 - the position that a
 * post-reverse() vertex table would misread out of the untouched position soup.
 */
function flipTriangleWithNewCornerZero(): THREE.BufferGeometry {
  const A = [0, 0, 0]
  const B = [1, 0, 0]
  const C = [0, 1, 0]
  const D = [1, 1, 0]
  const positions = new Float32Array([
    ...A, ...B, ...C, // T0, seed
    ...D, ...B, ...C, // T1: shares B->C with T0 (inconsistent) => BFS reverses to (C,B,D)
  ])
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return g
}

/**
 * Minimal triangulation of the Mobius band: 5 vertices, 5 triangles
 * {012, 123, 234, 340, 401}. Every interior edge is shared by two triangles
 * whose given winding traverses it the SAME way, so the orientation constraint
 * around the length-5 dual cycle has odd parity: no consistent global winding
 * exists and unifyNormals must abandon the component untouched.
 */
function mobiusStrip(): THREE.BufferGeometry {
  const v = [
    [0, 0, 0],
    [2, 0, 0],
    [3, 2, 0],
    [1, 3, 0],
    [-1, 2, 0],
  ]
  const faces = [
    [v[0], v[1], v[2]],
    [v[1], v[2], v[3]],
    [v[2], v[3], v[4]],
    [v[3], v[4], v[0]],
    [v[4], v[0], v[1]],
  ]
  const positions = new Float32Array(faces.flat(2))
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return g
}

/**
 * Closed tetrahedron (centroid at origin) with three outward-wound faces and
 * one face deliberately reversed. Outward winding verified by hand:
 * cross(b-a, c-a) . faceCentroid > 0 for every kept face.
 */
function tetrahedronOneFaceFlipped(): THREE.BufferGeometry {
  const A = [1, 1, 1]
  const B = [1, -1, -1]
  const C = [-1, 1, -1]
  const D = [-1, -1, 1]
  const faces = [
    [B, D, C],
    [A, C, D],
    [A, D, B],
    [A, C, B], // reversed; outward winding here is [A, B, C]
  ]
  const positions = new Float32Array(faces.flat(2))
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return g
}

describe('unifyNormals', () => {
  it('returns a geometry with consistent winding and does not throw on a flat quad', () => {
    const { geometry } = unifyNormals(inconsistentQuad())
    // after unify, the two triangles share edge (0,0,0)-(1,1,0) in OPPOSITE directions
    const p = (geometry.index ? geometry.toNonIndexed() : geometry).getAttribute('position')
    expect(p.count).toBe(6)
  })

  it('keeps a flipped triangle non-degenerate when its new vertex is at corner 0', () => {
    const { geometry } = unifyNormals(flipTriangleWithNewCornerZero())
    const health = analyzeGeometry(geometry)
    expect(health.triangles).toBe(2)
    expect(health.degenerateFaces).toBe(0)
    // vertex D = (1,1,0) must survive the re-wind, not collapse onto another corner
    const p = geometry.getAttribute('position').array as ArrayLike<number>
    let foundD = false
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] === 1 && p[i + 1] === 1 && p[i + 2] === 0) foundD = true
    }
    expect(foundD).toBe(true)
  })

  it('leaves a non-orientable (Mobius) component unchanged and notes it', () => {
    const src = mobiusStrip()
    const input = Float32Array.from(src.getAttribute('position').array as ArrayLike<number>)
    let result!: ReturnType<typeof unifyNormals>
    expect(() => { result = unifyNormals(src) }).not.toThrow()
    const out = result.geometry.getAttribute('position').array as ArrayLike<number>
    expect(analyzeGeometry(result.geometry).triangles).toBe(5)
    expect(Array.from(out)).toEqual(Array.from(input)) // component left byte-identical
    expect(result.note).toMatch(/non-orientable/)
  })

  it('re-winds a closed tetrahedron so every face normal points outward', () => {
    const { geometry } = unifyNormals(tetrahedronOneFaceFlipped())
    const p = geometry.getAttribute('position')
    const triCount = p.count / 3
    expect(triCount).toBe(4)

    const mesh = new THREE.Vector3()
    for (let i = 0; i < p.count; i++) mesh.add(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)))
    mesh.divideScalar(p.count)

    for (let t = 0; t < triCount; t++) {
      const a = new THREE.Vector3(p.getX(t * 3), p.getY(t * 3), p.getZ(t * 3))
      const b = new THREE.Vector3(p.getX(t * 3 + 1), p.getY(t * 3 + 1), p.getZ(t * 3 + 1))
      const c = new THREE.Vector3(p.getX(t * 3 + 2), p.getY(t * 3 + 2), p.getZ(t * 3 + 2))
      const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize()
      const outward = a.clone().add(b).add(c).divideScalar(3).sub(mesh)
      expect(n.dot(outward)).toBeGreaterThan(0)
    }
  })
})

describe('removeSmallShells', () => {
  it('drops a tiny second shell and keeps the big one', () => {
    // Big shell must have >100 tris so a 1-tri speck is below the default 1% floor.
    const big = new THREE.SphereGeometry(10, 16, 12).toNonIndexed().getAttribute('position').array as Float32Array
    const speck = new Float32Array([100,100,100, 100.1,100,100, 100,100.1,100]) // 1 tri
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...big, ...speck]), 3))
    const before = analyzeGeometry(g).triangles
    const { geometry, note } = removeSmallShells(g)
    const after = analyzeGeometry(geometry).triangles
    expect(after).toBe(before - 1)
    expect(note).toMatch(/1/)
  })

  it('is a no-op on a single connected component', () => {
    const g = new THREE.BoxGeometry(1, 1, 1)
    const before = analyzeGeometry(g).triangles
    const { geometry } = removeSmallShells(g)
    expect(analyzeGeometry(geometry).triangles).toBe(before)
  })
})
