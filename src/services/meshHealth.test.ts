import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { analyzeGeometry, summariseHealth } from './meshHealth'
import type { MeshHealth } from './meshHealth'

function soup(values: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(values, 3))
  return geometry
}

const h = (over: Partial<MeshHealth>): MeshHealth => ({
  triangles: 0, vertices: 0, boundaryEdges: 0, nonManifoldEdges: 0,
  duplicateFaces: 0, degenerateFaces: 0, watertight: true, ...over,
})

describe('summariseHealth', () => {
  it('sums counts across meshes', () => {
    const result = summariseHealth([
      h({ vertices: 10, boundaryEdges: 3, nonManifoldEdges: 1, degenerateFaces: 2, duplicateFaces: 0 }),
      h({ vertices: 5, boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 4 }),
    ])
    expect(result).toEqual({
      vertices: 15, boundaryEdges: 3, nonManifoldEdges: 1,
      degenerateFaces: 2, duplicateFaces: 4, watertight: true,
    })
  })

  it('watertight is the AND of every mesh', () => {
    expect(summariseHealth([h({ watertight: true }), h({ watertight: false })]).watertight).toBe(false)
  })

  it('watertight is false for no meshes', () => {
    expect(summariseHealth([]).watertight).toBe(false)
  })
})

describe('analyzeGeometry', () => {
  it('reports a closed box as watertight', () => {
    const box = new THREE.BoxGeometry(2, 2, 2)
    const health = analyzeGeometry(box)
    expect(health.watertight).toBe(true)
    expect(health.boundaryEdges).toBe(0)
    expect(health.nonManifoldEdges).toBe(0)
    expect(health.vertices).toBe(8)
    box.dispose()
  })

  it('counts the open edges of a single triangle', () => {
    const health = analyzeGeometry(soup([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    expect(health.triangles).toBe(1)
    expect(health.boundaryEdges).toBe(3)
    expect(health.watertight).toBe(false)
  })

  it('flags duplicate and degenerate faces', () => {
    const tri = [0, 0, 0, 1, 0, 0, 0, 1, 0]
    const degenerate = [0, 0, 0, 1, 0, 0, 2, 0, 0]
    const health = analyzeGeometry(soup([...tri, ...tri, ...degenerate]))
    expect(health.duplicateFaces).toBe(1)
    expect(health.degenerateFaces).toBe(1)
    expect(health.watertight).toBe(false)
  })

  it('returns zeros for geometry without a position attribute', () => {
    const health = analyzeGeometry(new THREE.BufferGeometry())
    expect(health).toEqual({
      triangles: 0, vertices: 0, boundaryEdges: 0, nonManifoldEdges: 0,
      duplicateFaces: 0, degenerateFaces: 0, watertight: false,
    })
  })
})
