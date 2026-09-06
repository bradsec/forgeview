import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildWallThicknessOverlay, disposeWallThicknessOverlay } from './wallThicknessOverlay'

/** A thin 0.5-unit slab: top face normal +Y, bottom -Y, 0.5 apart. */
function slabMesh(baseHex = 0x808080): THREE.Mesh {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0, 1, 0, 1, 1, 0, 0,
    0, -0.5, 0, 1, -0.5, 0, 1, -0.5, 1,
  ]), 3))
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: baseHex }))
}

describe('wallThicknessOverlay', () => {
  it('builds one tagged overlay mesh per eligible visible mesh and hides the original', () => {
    const mesh = slabMesh()
    const scene = new THREE.Scene()
    scene.add(mesh)
    mesh.updateMatrixWorld(true)

    const r = buildWallThicknessOverlay([mesh], 1.0, 1, () => true)
    expect(r.group.userData.wallThicknessOverlay).toBe(true)
    expect(r.group.children.length).toBe(1)
    expect(r.meshCount).toBe(1)
    expect(r.skippedMeshes).toBe(0)
    expect(mesh.visible).toBe(false)
    expect(r.hiddenMeshes).toEqual([mesh])

    const overlay = r.group.children[0] as THREE.Mesh
    const colorAttr = overlay.geometry.getAttribute('color')
    const posAttr = overlay.geometry.getAttribute('position')
    expect(colorAttr).toBeDefined()
    expect(colorAttr.count).toBe(posAttr.count)
    // Both slab faces are thin at 1.0 mm -> every vertex carries the highlight.
    const hi = new THREE.Color(0xff3b30)
    expect(colorAttr.getX(0)).toBeCloseTo(hi.r)
    expect(colorAttr.getY(0)).toBeCloseTo(hi.g)
    expect(colorAttr.getZ(0)).toBeCloseTo(hi.b)
  })

  it('leaves non-thin faces at the base colour', () => {
    const mesh = slabMesh(0x808080)
    mesh.updateMatrixWorld(true)
    // 0.2 mm minimum -> the 0.5-unit slab is NOT thin -> base colour.
    const r = buildWallThicknessOverlay([mesh], 0.2, 1, () => true)
    const overlay = r.group.children[0] as THREE.Mesh
    const colorAttr = overlay.geometry.getAttribute('color')
    const base = new THREE.Color(0x808080)
    expect(colorAttr.getX(0)).toBeCloseTo(base.r)
  })

  it('skips an already-hidden mesh without counting it as skipped-ineligible', () => {
    const mesh = slabMesh()
    mesh.visible = false
    mesh.updateMatrixWorld(true)
    const r = buildWallThicknessOverlay([mesh], 1.0, 1, () => true)
    expect(r.meshCount).toBe(0)
    expect(r.skippedMeshes).toBe(0)
    expect(r.group.children.length).toBe(0)
  })

  it('counts an ineligible mesh as skipped', () => {
    const mesh = slabMesh()
    mesh.updateMatrixWorld(true)
    const r = buildWallThicknessOverlay([mesh], 1.0, 1, () => false)
    expect(r.meshCount).toBe(0)
    expect(r.skippedMeshes).toBe(1)
    expect(mesh.visible).toBe(true)
  })

  it('reports unsampled faces', () => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 1, 1, 0, 0]), 3))
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x808080 }))
    mesh.updateMatrixWorld(true)
    const r = buildWallThicknessOverlay([mesh], 1.0, 1, () => true)
    expect(r.unsampledFaces).toBe(1)
  })

  it('dispose frees and detaches', () => {
    const mesh = slabMesh()
    mesh.updateMatrixWorld(true)
    const scene = new THREE.Scene()
    const r = buildWallThicknessOverlay([mesh], 1.0, 1, () => true)
    scene.add(r.group)
    disposeWallThicknessOverlay(r.group)
    expect(r.group.parent).toBeNull()
  })
})
