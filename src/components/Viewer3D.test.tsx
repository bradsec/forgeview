import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { Viewer3D } from './Viewer3D'
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
