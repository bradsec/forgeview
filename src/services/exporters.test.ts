import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js'
import { strFromU8 } from 'three/addons/libs/fflate.module.js'
import {
  collectExportMeshes,
  exportMeshes,
  exportSTL,
  export3MF,
  exportOBJ,
} from './exporters'

function sceneWithBox(size = 2): THREE.Scene {
  const scene = new THREE.Scene()
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    new THREE.MeshStandardMaterial({ color: 0xb0b0b0 })
  )
  scene.add(mesh)
  // Non-mesh children must not leak into exports
  scene.add(new THREE.GridHelper(10, 10))
  scene.add(new THREE.DirectionalLight())
  return scene
}

describe('collectExportMeshes', () => {
  it('collects only meshes and bakes world transforms', () => {
    const scene = sceneWithBox()
    const mesh = scene.children[0] as THREE.Mesh
    mesh.position.set(5, 0, 0)
    const collected = collectExportMeshes(scene)
    expect(collected).toHaveLength(1)
    const box = new THREE.Box3().setFromBufferAttribute(
      collected[0].geometry.getAttribute('position') as THREE.BufferAttribute
    )
    expect(box.getCenter(new THREE.Vector3()).x).toBeCloseTo(5)
  })

  it('exports meshes hidden by points view mode', () => {
    const scene = sceneWithBox()
    ;(scene.children[0] as THREE.Mesh).visible = false
    expect(collectExportMeshes(scene)).toHaveLength(1)
  })
})

describe('exportSTL', () => {
  it('produces binary STL that STLLoader parses back to 12 triangles', () => {
    const meshes = collectExportMeshes(sceneWithBox())
    const bytes = exportSTL(meshes)
    // Binary STL: 80-byte header + 4-byte count + 50 bytes per triangle
    expect(bytes.byteLength).toBe(84 + 12 * 50)
    const geometry = new STLLoader().parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    )
    expect(geometry.getAttribute('position').count).toBe(36)
  })
})

describe('export3MF', () => {
  it('produces a zip that ThreeMFLoader parses back', () => {
    const meshes = collectExportMeshes(sceneWithBox())
    const bytes = export3MF(meshes)
    // ZIP magic
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
    const group = new ThreeMFLoader().parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    ) as THREE.Group
    let triangles = 0
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const geo = child.geometry as THREE.BufferGeometry
        triangles += (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3
      }
    })
    expect(triangles).toBe(12)
  })
})

describe('exportOBJ', () => {
  it('produces OBJ text with vertices and faces', () => {
    const meshes = collectExportMeshes(sceneWithBox())
    const text = strFromU8(exportOBJ(meshes))
    expect(text).toContain('v ')
    expect(text).toContain('f ')
  })
})

describe('exportMeshes', () => {
  it('rejects an empty scene', async () => {
    await expect(exportMeshes([], '.stl')).rejects.toThrow('Nothing to export')
  })

  it('exports GLB with the glTF magic header', async () => {
    const meshes = collectExportMeshes(sceneWithBox())
    const bytes = await exportMeshes(meshes, '.glb')
    expect(strFromU8(bytes.slice(0, 4))).toBe('glTF')
  })

  it('exports binary PLY with the ply magic header', async () => {
    const meshes = collectExportMeshes(sceneWithBox())
    const bytes = await exportMeshes(meshes, '.ply')
    expect(strFromU8(bytes.slice(0, 3))).toBe('ply')
  })

  it('applies make solid before export', async () => {
    const scene = new THREE.Scene()
    const outer = new THREE.BoxGeometry(10, 10, 10).toNonIndexed()
    const inner = new THREE.BoxGeometry(4, 4, 4).toNonIndexed()
    const positions = new Float32Array(
      outer.getAttribute('position').count * 3 + inner.getAttribute('position').count * 3
    )
    positions.set(outer.getAttribute('position').array as Float32Array, 0)
    positions.set(inner.getAttribute('position').array as Float32Array, outer.getAttribute('position').count * 3)
    const merged = new THREE.BufferGeometry()
    merged.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    scene.add(new THREE.Mesh(merged, new THREE.MeshStandardMaterial()))

    const solidMeshes = collectExportMeshes(scene, { makeSolid: true })
    const bytes = exportSTL(solidMeshes)
    // Cavity removed: 12 triangles remain instead of 24
    expect(bytes.byteLength).toBe(84 + 12 * 50)
  })
})
