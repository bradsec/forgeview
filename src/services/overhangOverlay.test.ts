import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildOverhangOverlay, disposeOverhangOverlay } from './overhangOverlay'

function boxMesh(): THREE.Mesh {
  const geo = new THREE.BoxGeometry(1, 1, 1) // indexed by default
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x123456 }))
}

function triMesh(positions: number[], colorHex = 0x808080): THREE.Mesh {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: colorHex }))
  const scene = new THREE.Scene()
  scene.add(mesh)
  mesh.updateMatrixWorld(true)
  return mesh
}

describe('overhangOverlay', () => {
  it('builds one tagged overlay mesh per eligible mesh and hides the original', () => {
    const mesh = boxMesh()
    const scene = new THREE.Scene()
    scene.add(mesh)
    mesh.updateMatrixWorld(true)

    const result = buildOverhangOverlay([mesh], 45, () => true)

    expect(result.group.userData.overhangOverlay).toBe(true)
    expect(result.group.children.length).toBe(1)
    expect(result.meshCount).toBe(1)
    expect(result.skippedMeshes).toBe(0)
    expect(mesh.visible).toBe(false)
    expect(result.hiddenMeshes).toEqual([mesh])

    const overlayMesh = result.group.children[0] as THREE.Mesh
    const colorAttr = overlayMesh.geometry.getAttribute('color')
    const posAttr = overlayMesh.geometry.getAttribute('position')
    expect(colorAttr).toBeDefined()
    expect(colorAttr.count).toBe(posAttr.count)
    // BoxGeometry converted to non-indexed must not still carry an index.
    expect(overlayMesh.geometry.index).toBeNull()
  })

  it('counts an ineligible mesh as skipped and leaves it untouched', () => {
    const mesh = boxMesh()
    mesh.updateMatrixWorld(true)
    const result = buildOverhangOverlay([mesh], 45, () => false)
    expect(result.meshCount).toBe(0)
    expect(result.skippedMeshes).toBe(1)
    expect(result.group.children.length).toBe(0)
    expect(mesh.visible).toBe(true)
    expect(result.hiddenMeshes).toEqual([])
  })

  it('writes the highlight colour onto a flagged (straight-down) face', () => {
    // Winding yields normal (0,-1,0), flagged at threshold 45.
    const mesh = triMesh([0, 0, 0, 1, 0, 0, 1, 0, 1])
    const result = buildOverhangOverlay([mesh], 45, () => true)
    const colorAttr = (result.group.children[0] as THREE.Mesh).geometry.getAttribute('color')
    const highlight = new THREE.Color(0xff3b30)
    expect(colorAttr.getX(0)).toBeCloseTo(highlight.r)
    expect(colorAttr.getY(0)).toBeCloseTo(highlight.g)
    expect(colorAttr.getZ(0)).toBeCloseTo(highlight.b)
  })

  it('leaves an unflagged (vertical wall) face at the base material colour', () => {
    // Winding yields normal (1,0,0), never flagged.
    const mesh = triMesh([0, 0, 0, 0, 1, 0, 0, 1, 1], 0x808080)
    const result = buildOverhangOverlay([mesh], 45, () => true)
    const colorAttr = (result.group.children[0] as THREE.Mesh).geometry.getAttribute('color')
    const base = new THREE.Color(0x808080)
    expect(colorAttr.getX(0)).toBeCloseTo(base.r)
    expect(colorAttr.getY(0)).toBeCloseTo(base.g)
    expect(colorAttr.getZ(0)).toBeCloseTo(base.b)
  })

  it('dispose frees geometries/materials and detaches the group', () => {
    const mesh = boxMesh()
    mesh.updateMatrixWorld(true)
    const scene = new THREE.Scene()
    const result = buildOverhangOverlay([mesh], 45, () => true)
    scene.add(result.group)
    disposeOverhangOverlay(result.group)
    expect(result.group.parent).toBeNull()
  })
})
