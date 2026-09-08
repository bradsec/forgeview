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

import * as THREE from 'three'
import { loadModel } from '../loaders'
import { Viewer3D, type Viewer3DHandle } from './Viewer3D'
import { useViewerStore } from '../store/viewerStore'

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
