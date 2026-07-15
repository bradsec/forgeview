import { act, render } from '@testing-library/react'
import { createRef } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  class Renderer {
    domElement = document.createElement('canvas')
    toneMapping = actual.NoToneMapping
    toneMappingExposure = 1
    setPixelRatio() {}
    setSize() {}
    setClearColor() {}
    render() {}
    dispose() {}
  }
  return { ...actual, WebGLRenderer: Renderer }
})

import { Viewer3D } from './Viewer3D'
import type { Viewer3DHandle } from './Viewer3D'
import { useViewerStore } from '../store/viewerStore'

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

describe('Viewer3D performance settings', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverStub })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type) => {
      if (type !== '2d') return null
      return {
        createLinearGradient: () => ({ addColorStop() {} }),
        fillRect() {},
        set fillStyle(_value: string | CanvasGradient | CanvasPattern) {},
      } as unknown as CanvasRenderingContext2D
    })
  })

  beforeEach(() => {
    useViewerStore.setState({
      filePath: null,
      fileExtension: null,
      fileBuffer: null,
      loadedModels: [],
      performancePreset: 'high',
      performanceOverrides: {},
      theme: 'dark',
      error: null,
    })
  })

  it('applies the complete low preset when antialiasing recreates the renderer', () => {
    const ref = createRef<Viewer3DHandle>()
    const view = render(
      <Viewer3D ref={ref} filePath={null} fileExtension={null} viewMode="solid" />
    )

    act(() => useViewerStore.getState().setPerformancePreset('low'))

    const scene = ref.current?.getScene()
    const lights = scene?.children.filter((child) => child.type.endsWith('Light')) ?? []
    const grid = scene?.children.find((child) => child.type === 'GridHelper')
    expect(lights[0].visible).toBe(true)
    expect(lights[1].visible).toBe(true)
    expect(lights[2].visible).toBe(false)
    expect(lights[3].visible).toBe(false)
    expect(grid?.userData).toBeDefined()
    expect((grid as unknown as { _divisions: number })._divisions).toBe(10)

    view.unmount()
  })
})
