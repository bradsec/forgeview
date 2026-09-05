import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js'
import { strFromU8, unzipSync } from 'three/addons/libs/fflate.module.js'
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

  it('skips empty placeholder geometries left by make solid', async () => {
    // Repair collapses the scene into mesh[0] and leaves attribute-less
    // BufferGeometry placeholders on the remaining meshes.
    const scene = sceneWithBox()
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial()))
    const collected = collectExportMeshes(scene)
    expect(collected).toHaveLength(1)
    await expect(exportMeshes(collected, '.3mf')).resolves.toBeInstanceOf(Uint8Array)
  })

  it('preserves material arrays and reflected triangle winding', () => {
    const scene = new THREE.Scene()
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
    geometry.addGroup(0, 3, 1)
    const materials = [new THREE.MeshStandardMaterial({ color: 'red' }), new THREE.MeshStandardMaterial({ color: 'blue' })]
    const mesh = new THREE.Mesh(geometry, materials)
    mesh.scale.x = -1
    scene.add(mesh)

    const [collected] = collectExportMeshes(scene)
    const pos = collected.geometry.getAttribute('position')
    const index = collected.geometry.index
    const a = new THREE.Vector3().fromBufferAttribute(pos, index?.getX(0) ?? 0)
    const b = new THREE.Vector3().fromBufferAttribute(pos, index?.getX(1) ?? 1)
    const c = new THREE.Vector3().fromBufferAttribute(pos, index?.getX(2) ?? 2)
    const normal = b.sub(a).cross(c.sub(a))

    expect(Array.isArray(collected.material)).toBe(true)
    expect(normal.z).toBeGreaterThan(0)
  })

  it('reverses indexed winding for a mirrored mesh so faces still point outward', () => {
    // Mirror X in the transform panel is the UI path that puts a mesh at a
    // negative-determinant matrixWorld.
    const scene = new THREE.Scene()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial())
    mesh.scale.x = -1
    scene.add(mesh)

    const [collected] = collectExportMeshes(scene)
    const pos = collected.geometry.getAttribute('position')
    const index = collected.geometry.index!
    const outward: boolean[] = []
    for (let offset = 0; offset < index.count; offset += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, index.getX(offset))
      const b = new THREE.Vector3().fromBufferAttribute(pos, index.getX(offset + 1))
      const c = new THREE.Vector3().fromBufferAttribute(pos, index.getX(offset + 2))
      // Box is centred on the origin, so an outward normal points away from it.
      const centroid = a.clone().add(b).add(c).divideScalar(3)
      const normal = b.sub(a).cross(c.sub(a))
      outward.push(normal.dot(centroid) > 0)
    }

    expect(outward).toHaveLength(12)
    expect(outward.every(Boolean)).toBe(true)
  })

  it('expands every instance with its world transform', () => {
    const scene = new THREE.Scene()
    const instances = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial(), 2)
    instances.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-3, 0, 0))
    instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(4, 0, 0))
    scene.add(instances)

    const collected = collectExportMeshes(scene)
    const centers = collected.map((mesh) => new THREE.Box3().setFromBufferAttribute(
      mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    ).getCenter(new THREE.Vector3()).x)

    expect(centers).toEqual([-3, 4])
  })

  it('rejects live morph deformation instead of exporting the base shape', () => {
    const scene = new THREE.Scene()
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    geometry.morphAttributes.position = [geometry.getAttribute('position').clone()]
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial())
    mesh.updateMorphTargets()
    mesh.morphTargetInfluences![0] = 0.5
    scene.add(mesh)

    expect(() => collectExportMeshes(scene)).toThrow('morph-deformed')
  })

  it('skips meshes in groups tagged with userData.measureOverlay', () => {
    const scene = new THREE.Scene()
    const overlayGroup = new THREE.Group()
    overlayGroup.userData.measureOverlay = true
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial()
    )
    overlayGroup.add(mesh)
    scene.add(overlayGroup)

    expect(collectExportMeshes(scene)).toHaveLength(0)
  })

  it('skips meshes in groups tagged with userData.holeOverlay', () => {
    const scene = new THREE.Scene()
    const overlayGroup = new THREE.Group()
    overlayGroup.userData.holeOverlay = true
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial()
    )
    overlayGroup.add(mesh)
    scene.add(overlayGroup)

    expect(collectExportMeshes(scene)).toHaveLength(0)
  })

  it('skips meshes in groups tagged with userData.overhangOverlay', () => {
    const scene = new THREE.Scene()
    const overlayGroup = new THREE.Group()
    overlayGroup.userData.overhangOverlay = true
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial()
    )
    overlayGroup.add(mesh)
    scene.add(overlayGroup)

    expect(collectExportMeshes(scene)).toHaveLength(0)
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

  it('writes the selected physical unit into the model part', () => {
    const archive = unzipSync(export3MF(collectExportMeshes(sceneWithBox()), 'inch'))
    expect(strFromU8(archive['3D/3dmodel.model'])).toContain('unit="inch"')
  })
})

describe('exportOBJ', () => {
  it('produces OBJ text with vertices and faces', () => {
    const meshes = collectExportMeshes(sceneWithBox())
    const text = strFromU8(exportOBJ(meshes))
    expect(text).toContain('v ')
    expect(text).toContain('f ')
    const parsed = new OBJLoader().parse(text)
    const box = new THREE.Box3().setFromObject(parsed)
    expect(box.getSize(new THREE.Vector3()).toArray()).toEqual([2, 2, 2])
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
    const parsed = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      ''
    )
    expect(new THREE.Box3().setFromObject(parsed.scene).getSize(new THREE.Vector3()).toArray()).toEqual([2, 2, 2])
  })

  it('exports binary PLY with the ply magic header', async () => {
    const meshes = collectExportMeshes(sceneWithBox())
    const bytes = await exportMeshes(meshes, '.ply')
    expect(strFromU8(bytes.slice(0, 3))).toBe('ply')
    const geometry = new PLYLoader().parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    )
    geometry.computeBoundingBox()
    expect(geometry.boundingBox?.getSize(new THREE.Vector3()).toArray()).toEqual([2, 2, 2])
  })

  it('round-trips GLB material groups and colors', async () => {
    const scene = new THREE.Scene()
    const geometry = new THREE.BoxGeometry(2, 2, 2)
    geometry.clearGroups()
    geometry.addGroup(0, 18, 0)
    geometry.addGroup(18, geometry.index!.count - 18, 1)
    const materials = [
      new THREE.MeshStandardMaterial({ color: 0xff0000 }),
      new THREE.MeshStandardMaterial({ color: 0x0000ff }),
    ]
    scene.add(new THREE.Mesh(geometry, materials))
    const meshes = collectExportMeshes(scene)

    const bytes = await exportMeshes(meshes, '.glb')
    const parsed = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      ''
    )
    const colors: number[] = []
    parsed.scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const parsedMaterials = Array.isArray(child.material) ? child.material : [child.material]
      for (const material of parsedMaterials) {
        if ('color' in material && material.color instanceof THREE.Color) colors.push(material.color.getHex())
      }
    })
    expect(colors.sort((a, b) => a - b)).toEqual([0x0000ff, 0xff0000])
  })

})
