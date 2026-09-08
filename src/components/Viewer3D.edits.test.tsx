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
