import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { weldVertices, dropDegenerateFaces, dropDuplicateFaces, STAGE_LABEL } from './repairStages'
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
