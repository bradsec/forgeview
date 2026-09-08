import { act, cleanup, render } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  class Renderer {
    domElement = document.createElement('canvas')
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
  }
  return { ...actual, WebGLRenderer: Renderer }
})
vi.mock('../loaders', async (importOriginal) => ({
  ...await importOriginal<typeof import('../loaders')>(),
  loadModel: vi.fn(),
}))
vi.mock('../services/planeCut', () => ({ cutByPlane: vi.fn() }))
vi.mock('../services/hollowModel', () => ({ hollowModel: vi.fn() }))
vi.mock('../services/booleanMesh', () => ({ booleanMeshes: vi.fn() }))
vi.mock('../services/remesh', () => ({ remeshGeometryInWorker: vi.fn() }))

import * as THREE from 'three'
import { loadModel } from '../loaders'
import { Viewer3D, type Viewer3DHandle } from './Viewer3D'
import { useViewerStore } from '../store/viewerStore'
import { cutByPlane } from '../services/planeCut'
import { hollowModel } from '../services/hollowModel'
import { booleanMeshes } from '../services/booleanMesh'
import { remeshGeometryInWorker } from '../services/remesh'

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect() {},
  }) as unknown as CanvasRenderingContext2D)
})
beforeEach(() => {
  useViewerStore.setState(useViewerStore.getInitialState(), true)
  vi.mocked(loadModel).mockReset()
  vi.mocked(cutByPlane).mockReset()
  vi.mocked(hollowModel).mockReset()
  vi.mocked(booleanMeshes).mockReset()
  vi.mocked(remeshGeometryInWorker).mockReset()
})
afterEach(cleanup)

async function open(root: THREE.Object3D) {
  vi.mocked(loadModel).mockImplementation(async (_path, _ext, scene) => {
    scene.add(root)
    return root
  })
  const ref = createRef<Viewer3DHandle>()
  await act(async () => {
    useViewerStore.getState().setFile('/test.stl', 'test.stl', '.stl', 100)
    render(<Viewer3D ref={ref} filePath="/test.stl" fileExtension=".stl" viewMode="solid" />)
  })
  return ref
}

function twoShells() {
  const a = new THREE.BoxGeometry().toNonIndexed()
  const b = new THREE.BoxGeometry().toNonIndexed().translate(3, 0, 0)
  const positions = new Float32Array([...a.getAttribute('position').array, ...b.getAttribute('position').array])
  a.dispose()
  b.dispose()
  return new THREE.Mesh(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3)),
    new THREE.MeshStandardMaterial(),
  )
}

describe('split integrity', () => {
  it('rejects a mixed multi-mesh model without dropping its textured mesh', async () => {
    const root = new THREE.Group()
    const textured = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    root.add(twoShells(), textured)
    const ref = await open(root)
    expect(() => ref.current!.splitByShell()).toThrow('Split by shell needs a single-mesh model')
    expect(ref.current!.getScene()!.children).toContain(root)
    expect(useViewerStore.getState().splitParts).toHaveLength(0)
  })

  it('preserves physical units and dimensions across split and undo', async () => {
    const root = twoShells()
    root.userData.modelUnitInMm = 25.4
    const ref = await open(root)
    const before = ref.current!.getModelDimensionsMm()!.clone()
    act(() => { ref.current!.splitByShell() })
    expect(useViewerStore.getState().geometryDetails!.modelUnitInMm).toBe(25.4)
    expect(ref.current!.getModelDimensionsMm()!.toArray()).toEqual(before.toArray())
    act(() => ref.current!.undoEdit())
    expect(ref.current!.getModelDimensionsMm()!.toArray()).toEqual(before.toArray())
  })
})

describe('transforms', () => {
  it('drops and centers rotated asymmetric geometry using its actual vertices', async () => {
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, 4, 0, 0, 0, 3, 1,
    ], 3))
    const root = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial())
    root.rotation.z = 5 * Math.PI / 4
    root.position.set(10, 10, 10)
    const ref = await open(root)
    act(() => ref.current!.dropToFloor())
    expect(new THREE.Box3().expandByObject(root, true).min.y).toBeCloseTo(0)
    act(() => ref.current!.centerOnPlate())
    const center = new THREE.Box3().expandByObject(root, true).getCenter(new THREE.Vector3())
    expect(center.x).toBeCloseTo(0)
    expect(center.z).toBeCloseTo(0)
  })

  it('refreshes an armed heatmap after moving the model and undoing', async () => {
    const root = twoShells()
    const ref = await open(root)
    act(() => useViewerStore.getState().setOverhangMode(true))
    const overlayBox = () => {
      const overlay = ref.current!.getScene()!.children.find((node) => node.userData.overhangOverlay)!
      return new THREE.Box3().expandByObject(overlay, true)
    }
    const before = overlayBox().min.x
    act(() => ref.current!.moveModelBy({ x: 10, y: 0, z: 0 }))
    expect(overlayBox().min.x).toBeCloseTo(before + 10)
    act(() => ref.current!.undoEdit())
    expect(overlayBox().min.x).toBeCloseTo(before)
  })
})

describe('scene lifecycle', () => {
  it('clears undo resources and labels when the viewer unmounts', async () => {
    const root = twoShells()
    const dispose = vi.spyOn(root.geometry, 'dispose')
    const ref = await open(root)
    act(() => ref.current!.splitByShell())
    expect(dispose).not.toHaveBeenCalled()
    cleanup()
    expect(dispose).toHaveBeenCalled()
    expect(useViewerStore.getState().undoLabels).toEqual([])
  })

  it('refreshes scene dimensions when an assembly model is removed', async () => {
    const meshes = [twoShells(), twoShells()]
    meshes[1].position.x = 100
    vi.mocked(loadModel).mockImplementation(async (path, _ext, scene) => {
      const root = meshes[path === '/a.stl' ? 0 : 1]
      scene.add(root)
      return root
    })
    await act(async () => {
      useViewerStore.setState({ loadedModels: ['a', 'b'].map((id) => ({
        id, path: `/${id}.stl`, name: id, extension: '.stl', sizeBytes: 100, triangleCount: 0,
      })) })
      render(<Viewer3D filePath={null} fileExtension={null} viewMode="solid" />)
    })
    expect(useViewerStore.getState().geometryDetails!.width).toBe(104)
    act(() => useViewerStore.getState().removeModel('b'))
    expect(useViewerStore.getState().geometryDetails!.width).toBe(4)
  })
})

describe('solid edit transactions', () => {
  it('cuts into parts, deletes one, and restores each step with units intact', async () => {
    const root = twoShells()
    root.userData.modelUnitInMm = 25.4
    const ref = await open(root)
    const positions = new Float32Array(root.geometry.getAttribute('position').array)
    vi.mocked(cutByPlane).mockResolvedValue({ partA: positions, partB: positions })
    act(() => useViewerStore.getState().setClipMode(true))
    await act(async () => ref.current!.cutAtPlane())
    expect(useViewerStore.getState().splitParts).toHaveLength(2)
    expect(useViewerStore.getState().geometryDetails!.modelUnitInMm).toBe(25.4)
    const first = useViewerStore.getState().splitParts[0].id
    act(() => ref.current!.deleteSplitPart(first))
    expect(useViewerStore.getState().splitParts).toHaveLength(1)
    expect(ref.current!.getSplitPart(first)).toBeUndefined()
    act(() => ref.current!.undoEdit())
    expect(useViewerStore.getState().splitParts).toHaveLength(2)
    act(() => ref.current!.undoEdit())
    expect(ref.current!.getScene()!.children).toContain(root)
    expect(useViewerStore.getState().splitParts).toHaveLength(0)
  })

  it('rejects stale worker results after a transform without modifying geometry', async () => {
    const root = twoShells()
    root.userData.modelUnitInMm = 1
    const original = root.geometry
    const ref = await open(root)
    let finish!: (positions: Float32Array) => void
    vi.mocked(hollowModel).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    let result!: Promise<void>
    await act(async () => { result = ref.current!.hollowModel({ wallThickness: 1, resolution: 32, drainRadius: 0, drainAxis: 'y', drainOffset: [0, 0, 0] }) })
    act(() => ref.current!.moveModelBy({ x: 5, y: 0, z: 0 }))
    finish(new Float32Array(original.getAttribute('position').array))
    await expect(result).rejects.toThrow('The model changed while the operation was running')
    expect(root.geometry).toBe(original)
    expect(useViewerStore.getState().undoLabels).toEqual(['Move'])
  })

  it('restores remesh geometry on undo and preserves it on failure', async () => {
    const root = twoShells()
    const original = root.geometry
    const ref = await open(root)
    vi.mocked(remeshGeometryInWorker).mockRejectedValueOnce(new Error('Unsupported topology'))
    await expect(ref.current!.remeshModel({ operation: 'decimate', targetTriangles: 12 })).rejects.toThrow('Unsupported topology')
    expect(root.geometry).toBe(original)
    vi.mocked(remeshGeometryInWorker).mockResolvedValue({ geometry: original.clone(), beforeTriangles: 24, afterTriangles: 24 })
    await act(async () => ref.current!.remeshModel({ operation: 'decimate', targetTriangles: 12 }))
    expect(root.geometry).not.toBe(original)
    act(() => ref.current!.undoEdit())
    expect(root.geometry).toBe(original)
  })

  it('consumes two boolean operands atomically and restores both with undo', async () => {
    const meshes = [twoShells(), twoShells()]
    const originals = meshes.map(mesh => mesh.geometry)
    meshes.forEach(mesh => { mesh.userData.modelUnitInMm = 1 })
    vi.mocked(loadModel).mockImplementation(async (path, _ext, scene) => {
      const mesh = meshes[path === '/a.stl' ? 0 : 1]
      scene.add(mesh)
      return mesh
    })
    const ref = createRef<Viewer3DHandle>()
    await act(async () => {
      useViewerStore.setState({ loadedModels: ['a', 'b'].map(id => ({ id, path: `/${id}.stl`, name: id, extension: '.stl', sizeBytes: 100, triangleCount: 0 })) })
      render(<Viewer3D ref={ref} filePath={null} fileExtension={null} viewMode="solid" />)
    })
    vi.mocked(booleanMeshes).mockResolvedValue(new Float32Array(originals[0].getAttribute('position').array))
    await act(async () => ref.current!.booleanOperation('a', 'b', 'union'))
    expect(meshes[1].geometry.getAttribute('position')).toBeUndefined()
    act(() => ref.current!.undoEdit())
    expect(meshes.map(mesh => mesh.geometry)).toEqual(originals)
    vi.mocked(booleanMeshes).mockResolvedValue(new Float32Array())
    await expect(ref.current!.booleanOperation('a', 'b', 'intersection')).rejects.toThrow('empty result')
    expect(meshes.map(mesh => mesh.geometry)).toEqual(originals)
  })
})
