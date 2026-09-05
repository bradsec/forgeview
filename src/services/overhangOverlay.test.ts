import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildOverhangOverlay, disposeOverhangOverlay } from './overhangOverlay'

function boxMesh(): THREE.Mesh {
  const geo = new THREE.BoxGeometry(1, 1, 1) // indexed by default
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x123456 }))
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
