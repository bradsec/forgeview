import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'
import {
  makeOverlayMaterials, buildLoopOverlays, disposeLoopOverlays, pickOverlay,
} from './holeFillOverlay'

function openCubeMesh(offset = 0): THREE.Mesh {
  const full = new THREE.BoxGeometry(1, 1, 1).toNonIndexed().getAttribute('position').array as Float32Array
  const keep = new Float32Array([...full.slice(0, 18 * 4), ...full.slice(18 * 5, 18 * 6)])
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(keep, 3))
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial())
  m.position.x = offset
  return m
}

const eligibleAll = () => true

describe('buildLoopOverlays', () => {
  it('creates one overlay group per open loop, tagged and world-placed', () => {
    const mesh = openCubeMesh(10)
    const mats = makeOverlayMaterials()
    const { entries, skippedMeshes } = buildLoopOverlays([mesh], eligibleAll, mats)
    expect(entries.length).toBe(1)
    expect(skippedMeshes).toBe(0)
    expect(entries[0].group.userData.holeOverlay).toBe(true)
    expect(entries[0].cap.geometry.getAttribute('position').count).toBe(12) // 4 fan tris
    // world-placed: cap centroid near x=10
    entries[0].cap.geometry.computeBoundingBox()
    const c = new THREE.Vector3()
    entries[0].cap.geometry.boundingBox!.getCenter(c)
    expect(c.x).toBeCloseTo(10, 1)
  })

  it('counts ineligible meshes and skips them', () => {
    const a = openCubeMesh(0)
    const b = openCubeMesh(10)
    const mats = makeOverlayMaterials()
    const { entries, skippedMeshes } = buildLoopOverlays([a, b], (m) => m === a, mats)
    expect(entries.length).toBe(1)
    expect(skippedMeshes).toBe(1)
  })
})

describe('disposeLoopOverlays', () => {
  it('disposes geometries and detaches groups', () => {
    const mesh = openCubeMesh(0)
    const parent = new THREE.Group()
    const mats = makeOverlayMaterials()
    const { entries } = buildLoopOverlays([mesh], eligibleAll, mats)
    for (const e of entries) parent.add(e.group)
    const capDispose = vi.spyOn(entries[0].cap.geometry, 'dispose')
    disposeLoopOverlays(entries)
    expect(capDispose).toHaveBeenCalledOnce()
    expect(parent.children.length).toBe(0)
  })
})

describe('pickOverlay', () => {
  it('returns the entry whose cap the ray hits, else -1', () => {
    const mesh = openCubeMesh(0)
    const mats = makeOverlayMaterials()
    const { entries } = buildLoopOverlays([mesh], eligibleAll, mats)
    const scene = new THREE.Group()
    for (const e of entries) scene.add(e.group)
    // ray straight down the -Z axis from above the +Z hole (cap sits at z=0.5)
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1))
    expect(pickOverlay(entries, ray)).toBe(0)
    const miss = new THREE.Raycaster(new THREE.Vector3(50, 50, 5), new THREE.Vector3(0, 0, -1))
    expect(pickOverlay(entries, miss)).toBe(-1)
  })
})
