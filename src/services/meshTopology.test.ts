import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { KEY, triModel, vertexTable, rebuild, fromPositions, nonIndexedPositions } from './meshTopology'

describe('KEY', () => {
  it('rounds coincident-within-1e6 coords to the same key', () => {
    expect(KEY(1, 2, 3)).toBe(KEY(1 + 1e-8, 2 - 1e-8, 3))
    expect(KEY(1, 0, 0)).not.toBe(KEY(1.001, 0, 0))
  })
})

describe('triModel', () => {
  it('merges the split cube to 8 distinct vertices and 12 triangles', () => {
    const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed()
    const { tris, vertexCount } = triModel(g)
    expect(tris.length).toBe(12)
    expect(vertexCount).toBe(8)
  })
})

describe('vertexTable + rebuild round-trip', () => {
  it('rebuilds an equivalent geometry from the merged model', () => {
    const g = new THREE.BoxGeometry(2, 2, 2).toNonIndexed()
    const { positions, tris, vertexCount } = triModel(g)
    const table = vertexTable(positions, tris, vertexCount)
    const back = rebuild(tris, (id) => table[id])
    expect(back.getAttribute('position').count).toBe(36)
    // same bounding box
    g.computeBoundingBox(); back.computeBoundingBox()
    expect(back.boundingBox!.min.toArray()).toEqual(g.boundingBox!.min.toArray())
    expect(back.boundingBox!.max.toArray()).toEqual(g.boundingBox!.max.toArray())
  })
})

describe('fromPositions', () => {
  it('produces a non-indexed geometry with vertex normals', () => {
    const geo = fromPositions(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    expect(geo.index).toBeNull()
    expect(geo.getAttribute('normal')).toBeTruthy()
  })
})

describe('nonIndexedPositions', () => {
  it('expands an indexed geometry to a flat soup copy', () => {
    const g = new THREE.BoxGeometry(1, 1, 1) // indexed
    const soup = nonIndexedPositions(g)
    expect(soup.length).toBe(36 * 3)
    expect(soup).toBeInstanceOf(Float32Array)
  })
})
