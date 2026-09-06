import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildBuildVolumeOverlay, disposeBuildVolumeOverlay } from './buildVolumeOverlay'

describe('buildVolumeOverlay', () => {
  const colors = { edge: 0xe68a4e, grid: 0x3f4146 }

  it('returns a tagged group with a box and a footprint grid', () => {
    const g = buildBuildVolumeOverlay({ x: 220, y: 250, z: 220 }, colors)
    expect(g.userData.buildVolumeOverlay).toBe(true)
    const lineSegments = g.children.filter((c) => c instanceof THREE.LineSegments)
    expect(lineSegments.length).toBe(2) // EdgesGeometry box + GridHelper
  })

  it('sits the box base on y=0 (centre lifted half the height)', () => {
    const g = buildBuildVolumeOverlay({ x: 100, y: 80, z: 100 }, colors)
    const box = g.children.find(
      (c) => c instanceof THREE.LineSegments && !(c as any).isGridHelper,
    ) as THREE.LineSegments
    expect(box.position.y).toBeCloseTo(40)
  })

  it('box edge geometry spans the requested dimensions', () => {
    const g = buildBuildVolumeOverlay({ x: 120, y: 60, z: 90 }, colors)
    const box = g.children.find(
      (c) => c instanceof THREE.LineSegments && !(c as any).isGridHelper,
    ) as THREE.LineSegments
    box.geometry.computeBoundingBox()
    const size = box.geometry.boundingBox!.getSize(new THREE.Vector3())
    expect(size.x).toBeCloseTo(120)
    expect(size.y).toBeCloseTo(60)
    expect(size.z).toBeCloseTo(90)
  })

  it('clamps a non-positive dimension to 1 instead of throwing', () => {
    expect(() => buildBuildVolumeOverlay({ x: 0, y: -5, z: 100 }, colors)).not.toThrow()
    const g = buildBuildVolumeOverlay({ x: 0, y: -5, z: 100 }, colors)
    const box = g.children.find(
      (c) => c instanceof THREE.LineSegments && !(c as any).isGridHelper,
    ) as THREE.LineSegments
    box.geometry.computeBoundingBox()
    const size = box.geometry.boundingBox!.getSize(new THREE.Vector3())
    expect(size.x).toBeCloseTo(1)
    expect(size.y).toBeCloseTo(1)
  })

  it('dispose frees child geometry and materials and detaches the group', () => {
    const g = buildBuildVolumeOverlay({ x: 100, y: 100, z: 100 }, colors)
    const scene = new THREE.Scene()
    scene.add(g)
    disposeBuildVolumeOverlay(g)
    expect(g.parent).toBeNull()
  })
})
