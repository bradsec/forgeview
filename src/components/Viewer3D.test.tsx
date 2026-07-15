import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import * as THREE from 'three'
import { Viewer3D, disposeViewerResources, perspectiveCameraFrom } from './Viewer3D'
import { useViewerStore } from '../store/viewerStore'

// jsdom has no WebGL: canvas.getContext('webgl2'/'webgl') returns null, so
// THREE.WebGLRenderer construction throws — same failure mode as a browser
// with the GPU blocklisted or hardware acceleration disabled.

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('Viewer3D without WebGL', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
      ResizeObserverStub
    useViewerStore.setState({
      filePath: null,
      fileExtension: null,
      fileBuffer: null,
      loadedModels: [],
      error: null,
      isLoading: false,
    })
  })

  it('surfaces a store error instead of crashing', () => {
    expect(() =>
      render(<Viewer3D filePath={null} fileExtension={null} viewMode="solid" />)
    ).not.toThrow()
    expect(useViewerStore.getState().error).toMatch(/WebGL/)
  })
})

describe('disposeViewerResources', () => {
  it('disposes preview, assembly, grid, and background resources', () => {
    const scene = new THREE.Scene()
    const preview = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
    const assembly = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
    const grid = new THREE.GridHelper()
    const background = new THREE.Texture()
    const previewGeometry = vi.spyOn(preview.geometry, 'dispose')
    const assemblyGeometry = vi.spyOn(assembly.geometry, 'dispose')
    const gridDispose = vi.spyOn(grid, 'dispose')
    const backgroundDispose = vi.spyOn(background, 'dispose')
    scene.add(preview, assembly, grid)
    scene.background = background

    disposeViewerResources(scene, preview, [assembly], grid)

    expect(previewGeometry).toHaveBeenCalledOnce()
    expect(assemblyGeometry).toHaveBeenCalledOnce()
    expect(gridDispose).toHaveBeenCalledOnce()
    expect(backgroundDispose).toHaveBeenCalledOnce()
    expect(scene.children).toHaveLength(0)
  })
})

describe('perspectiveCameraFrom', () => {
  it('preserves fitted clipping planes', () => {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.005, 2_000_000)

    const result = perspectiveCameraFrom(camera, 1600, 900)

    expect(result.near).toBe(0.005)
    expect(result.far).toBe(2_000_000)
    expect(result.aspect).toBeCloseTo(16 / 9)
  })
})
