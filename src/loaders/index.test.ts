import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as THREE from 'three'

// Mock @tauri-apps/api/core before importing the module under test
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import {
  getLoaderForExtension,
  countTriangles,
  applyViewMode,
  disposeModel,
  loadModel,
  loadModelFromBuffer,
  parseModelBuffer,
  fitModelToView,
  fitAllModels,
  SUPPORTED_EXTENSIONS,
} from './index'

import { invoke } from '@tauri-apps/api/core'

describe('SUPPORTED_EXTENSIONS', () => {
  it('contains all required extensions', () => {
    expect(SUPPORTED_EXTENSIONS).toContain('.stl')
    expect(SUPPORTED_EXTENSIONS).toContain('.3mf')
    expect(SUPPORTED_EXTENSIONS).toContain('.obj')
    expect(SUPPORTED_EXTENSIONS).toContain('.gltf')
    expect(SUPPORTED_EXTENSIONS).toContain('.glb')
    expect(SUPPORTED_EXTENSIONS).toContain('.ply')
    expect(SUPPORTED_EXTENSIONS).toContain('.dae')
  })
})

describe('getLoaderForExtension', () => {
  it('returns a loader for .stl', () => {
    const loader = getLoaderForExtension('.stl')
    expect(loader).not.toBeNull()
  })

  it('returns a loader for .3mf', () => {
    const loader = getLoaderForExtension('.3mf')
    expect(loader).not.toBeNull()
  })

  it('returns a loader for .obj', () => {
    const loader = getLoaderForExtension('.obj')
    expect(loader).not.toBeNull()
  })

  it('returns a loader for .gltf', () => {
    const loader = getLoaderForExtension('.gltf')
    expect(loader).not.toBeNull()
  })

  it('returns a loader for .glb', () => {
    const loader = getLoaderForExtension('.glb')
    expect(loader).not.toBeNull()
  })

  it('returns a loader for .ply', () => {
    const loader = getLoaderForExtension('.ply')
    expect(loader).not.toBeNull()
  })

  it('returns a loader for .dae', () => {
    const loader = getLoaderForExtension('.dae')
    expect(loader).not.toBeNull()
  })

  it('returns null for unknown extension', () => {
    const loader = getLoaderForExtension('.unknown')
    expect(loader).toBeNull()
  })

  it('is case-insensitive', () => {
    const loader = getLoaderForExtension('.STL')
    expect(loader).not.toBeNull()
  })
})

describe('countTriangles', () => {
  it('counts triangles from indexed geometry', () => {
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array(9 * 4) // 12 vertices
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const indices = new Uint16Array([0, 1, 2, 3, 4, 5, 6, 7, 8]) // 3 triangles
    geo.setIndex(new THREE.BufferAttribute(indices, 1))

    const mesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial())
    const group = new THREE.Group()
    group.add(mesh)

    expect(countTriangles(group)).toBe(3)
  })

  it('counts triangles from non-indexed geometry', () => {
    const geo = new THREE.BufferGeometry()
    // 9 vertices * 3 components = 27 floats; 9 vertices / 3 per triangle = 3 triangles
    const positions = new Float32Array(9 * 3)
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))

    const mesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial())
    const group = new THREE.Group()
    group.add(mesh)

    expect(countTriangles(group)).toBe(3)
  })

  it('returns 0 for empty group', () => {
    const group = new THREE.Group()
    expect(countTriangles(group)).toBe(0)
  })

  it('sums triangles from multiple meshes', () => {
    const makeIndexedMesh = (triCount: number) => {
      const geo = new THREE.BufferGeometry()
      const positions = new Float32Array(triCount * 9)
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const indices = new Uint16Array(triCount * 3)
      for (let i = 0; i < triCount * 3; i++) indices[i] = i % (triCount * 3)
      geo.setIndex(new THREE.BufferAttribute(indices, 1))
      return new THREE.Mesh(geo, new THREE.MeshPhongMaterial())
    }

    const group = new THREE.Group()
    group.add(makeIndexedMesh(10))
    group.add(makeIndexedMesh(5))
    expect(countTriangles(group)).toBe(15)
  })
})

describe('applyViewMode', () => {
  let mesh: THREE.Mesh
  let material: THREE.MeshPhongMaterial
  let group: THREE.Group

  beforeEach(() => {
    material = new THREE.MeshPhongMaterial({ color: 0x888888 })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3))
    mesh = new THREE.Mesh(geo, material)
    group = new THREE.Group()
    group.add(mesh)
  })

  it('sets wireframe=false and visible=true for solid mode', () => {
    material.wireframe = true
    applyViewMode(group, 'solid')
    expect(material.wireframe).toBe(false)
    expect(mesh.visible).toBe(true)
  })

  it('sets wireframe=true and visible=true for wireframe mode', () => {
    applyViewMode(group, 'wireframe')
    expect(material.wireframe).toBe(true)
    expect(mesh.visible).toBe(true)
  })

  it('sets mesh invisible for points mode', () => {
    applyViewMode(group, 'points')
    expect(mesh.visible).toBe(false)
  })

  it('adds Points companion for points mode', () => {
    applyViewMode(group, 'points')
    const companions = group.userData.pointsCompanions as THREE.Points[]
    expect(companions.length).toBeGreaterThan(0)
    // Companion should be in the scene graph
    expect(group.children.filter((c) => c instanceof THREE.Points).length).toBeGreaterThan(0)
  })

  it('removes Points companions when switching to solid', () => {
    applyViewMode(group, 'points')
    applyViewMode(group, 'solid')
    const companions = group.userData.pointsCompanions as THREE.Points[]
    expect(companions).toHaveLength(0)
    expect(group.children.filter((c) => c instanceof THREE.Points)).toHaveLength(0)
  })
})

describe('disposeModel', () => {
  it('removes object from scene', () => {
    const scene = new THREE.Scene()
    const group = new THREE.Group()
    scene.add(group)
    expect(scene.children).toContain(group)

    disposeModel(group, scene)
    expect(scene.children).not.toContain(group)
  })

  it('disposes geometry and materials', () => {
    const scene = new THREE.Scene()
    const geo = new THREE.BufferGeometry()
    const mat = new THREE.MeshPhongMaterial()
    const mesh = new THREE.Mesh(geo, mat)
    const group = new THREE.Group()
    group.add(mesh)
    scene.add(group)

    const disposeSpy = vi.spyOn(geo, 'dispose')
    const matDisposeSpy = vi.spyOn(mat, 'dispose')

    disposeModel(group, scene)

    expect(disposeSpy).toHaveBeenCalled()
    expect(matDisposeSpy).toHaveBeenCalled()
  })

  it('handles array materials', () => {
    const scene = new THREE.Scene()
    const geo = new THREE.BufferGeometry()
    const mat1 = new THREE.MeshPhongMaterial()
    const mat2 = new THREE.MeshPhongMaterial()
    const mesh = new THREE.Mesh(geo, [mat1, mat2])
    const group = new THREE.Group()
    group.add(mesh)
    scene.add(group)

    const mat1Spy = vi.spyOn(mat1, 'dispose')
    const mat2Spy = vi.spyOn(mat2, 'dispose')

    disposeModel(group, scene)

    expect(mat1Spy).toHaveBeenCalled()
    expect(mat2Spy).toHaveBeenCalled()
  })

  it('disposes geometry and material on Line children', () => {
    const scene = new THREE.Scene()
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    const mat = new THREE.LineBasicMaterial({ color: 0xff0000 })
    const line = new THREE.Line(geo, mat)
    const group = new THREE.Group()
    group.add(line)
    scene.add(group)

    const geoDisposeSpy = vi.spyOn(geo, 'dispose')
    const matDisposeSpy = vi.spyOn(mat, 'dispose')

    disposeModel(group, scene)

    expect(geoDisposeSpy).toHaveBeenCalled()
    expect(matDisposeSpy).toHaveBeenCalled()
  })
})

describe('loadModel', () => {
  it('is exported as a function', () => {
    expect(typeof loadModel).toBe('function')
  })

  it('calls invoke with read_file_bytes', async () => {
    // Minimal valid binary STL: 80-byte header + uint32 triangle count (0) = 84 bytes.
    // read_file_bytes resolves to an ArrayBuffer (tauri::ipc::Response raw payload).
    const mockBytes = new Uint8Array(84).buffer

    vi.mocked(invoke).mockResolvedValueOnce(mockBytes)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera()

    try {
      await loadModel('/path/to/file.stl', '.stl', scene, camera)
    } catch (_e) {
      // May throw due to jsdom WebGL limitations — that's OK
    }

    expect(invoke).toHaveBeenCalledWith('read_file_bytes', { path: '/path/to/file.stl' })
  })

  it('throws for unsupported extension', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([])
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera()

    await expect(loadModel('/path/to/file.xyz', '.xyz', scene, camera)).rejects.toThrow(
      'Unsupported format: .xyz'
    )
  })
})

describe('fitAllModels', () => {
  // Mock OrbitControls-like object (avoids DOM dependency)
  function makeMockControls() {
    return {
      target: new THREE.Vector3(),
      update: vi.fn(),
    }
  }

  it('does not throw for empty array', () => {
    const camera = new THREE.PerspectiveCamera()
    const controls = makeMockControls()
    expect(() => fitAllModels([], camera, controls as any)).not.toThrow()
  })

  it('does not call controls.update for empty array', () => {
    const camera = new THREE.PerspectiveCamera()
    const controls = makeMockControls()
    fitAllModels([], camera, controls as any)
    expect(controls.update).not.toHaveBeenCalled()
  })

  it('positions camera to encompass two objects at different locations', () => {
    const camera = new THREE.PerspectiveCamera()
    const controls = makeMockControls()

    // Create two meshes at known positions
    const geo1 = new THREE.BoxGeometry(2, 2, 2)
    const mesh1 = new THREE.Mesh(geo1, new THREE.MeshBasicMaterial())
    mesh1.position.set(0, 0, 0)

    const geo2 = new THREE.BoxGeometry(2, 2, 2)
    const mesh2 = new THREE.Mesh(geo2, new THREE.MeshBasicMaterial())
    mesh2.position.set(10, 0, 0)

    fitAllModels([mesh1, mesh2], camera, controls as any)

    // Camera should be positioned in positive Z (behind the scene)
    expect(camera.position.z).toBeGreaterThan(0)
    // Camera target should be near the center of both objects (x ~= 5)
    expect(controls.target.x).toBeCloseTo(5, 0)
    // controls.update should be called
    expect(controls.update).toHaveBeenCalled()
  })

  it('updates camera.near and camera.far', () => {
    const camera = new THREE.PerspectiveCamera()
    const initialNear = camera.near
    const initialFar = camera.far
    const controls = makeMockControls()

    const geo = new THREE.BoxGeometry(100, 100, 100)
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial())

    fitAllModels([mesh], camera, controls as any)

    // near and far should be updated based on model size
    expect(camera.near).not.toBe(initialNear)
    expect(camera.far).not.toBe(initialFar)
  })

  it('single object: camera positioned proportionally to object size', () => {
    const camera = new THREE.PerspectiveCamera()
    const controls = makeMockControls()

    const geo = new THREE.BoxGeometry(10, 10, 10)
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial())
    mesh.position.set(0, 0, 0)

    fitAllModels([mesh], camera, controls as any)

    // Camera far should be 100x the maxDim (10), so far = 1000
    expect(camera.far).toBeCloseTo(1000, 0)
  })

  it('rejects a scene with no renderable geometry', () => {
    const camera = new THREE.PerspectiveCamera()
    const controls = makeMockControls()

    expect(() => fitAllModels([new THREE.Group()], camera, controls as any)).toThrow(
      'Scene has no renderable geometry'
    )
  })
})

describe('fitModelToView', () => {
  it('rejects a model with no renderable geometry', () => {
    const camera = new THREE.PerspectiveCamera()

    expect(() => fitModelToView(new THREE.Group(), camera)).toThrow(
      'Model has no renderable geometry'
    )
  })
})

describe('parseModelBuffer / loadModelFromBuffer (browser path)', () => {
  const asciiStl = `solid test
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid test
`
  const stlBuffer = () => new TextEncoder().encode(asciiStl).buffer as ArrayBuffer

  it('parses an ASCII STL buffer into a Mesh without Tauri IPC', async () => {
    vi.mocked(invoke).mockClear()
    const obj = await parseModelBuffer(stlBuffer(), '.stl')
    expect(obj).toBeInstanceOf(THREE.Mesh)
    const mesh = obj as THREE.Mesh
    expect(mesh.geometry.attributes.position.count).toBe(3)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('rejects unsupported extensions', async () => {
    await expect(parseModelBuffer(stlBuffer(), '.xyz')).rejects.toThrow('Unsupported format: .xyz')
  })

  it('loadModelFromBuffer adds the parsed model to the scene', async () => {
    vi.mocked(invoke).mockClear()
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera()
    const obj = await loadModelFromBuffer(stlBuffer(), '.stl', scene, camera)
    expect(scene.children).toContain(obj)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('loadModelFromBuffer skips centering when center=false', async () => {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(9, 9, 9)
    await loadModelFromBuffer(stlBuffer(), '.stl', scene, camera, { center: false })
    expect(camera.position.toArray()).toEqual([9, 9, 9])
  })
})
