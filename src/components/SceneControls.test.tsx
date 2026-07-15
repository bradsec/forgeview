import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SceneControls } from './SceneControls'
import type { Viewer3DHandle } from './Viewer3D'

vi.mock('./ViewCube', () => ({ ViewCube: () => <div data-testid="view-cube" /> }))

describe('SceneControls', () => {
  it('offers keyboard-accessible standard views', async () => {
    const snapToView = vi.fn()
    const viewerRef = {
      current: {
        snapToView,
        fitAll: vi.fn(),
        resetCamera: vi.fn(),
        zoomIn: vi.fn(),
        zoomOut: vi.fn(),
        orbitBy: vi.fn(),
        getCamera: vi.fn(),
        getScene: vi.fn(),
      } satisfies Viewer3DHandle,
    }
    render(<SceneControls viewerRef={viewerRef} />)

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Standard view' }), 'front')

    expect(snapToView).toHaveBeenCalledWith('front')
  })
})
