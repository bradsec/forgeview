import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SceneContextMenu } from './SceneContextMenu'
import type { Viewer3DHandle } from './Viewer3D'
import { useViewerStore } from '../store/viewerStore'

describe('SceneContextMenu', () => {
  it('opens on right click and runs camera actions', async () => {
    const fitAll = vi.fn()
    const viewerRef = { current: { fitAll, resetCamera: vi.fn(), snapToView: vi.fn() } as unknown as Viewer3DHandle }
    render(<SceneContextMenu viewerRef={viewerRef}><div>scene</div></SceneContextMenu>)

    await userEvent.pointer({ target: screen.getByText('scene'), keys: '[MouseRight]' })
    expect(screen.getByRole('menu', { name: 'Scene actions' })).toBeTruthy()

    await userEvent.click(screen.getByRole('menuitem', { name: 'Fit all' }))
    expect(fitAll).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('changes the display mode', async () => {
    useViewerStore.setState({ viewMode: 'solid' })
    const viewerRef = { current: {} as Viewer3DHandle }
    render(<SceneContextMenu viewerRef={viewerRef}><div>scene</div></SceneContextMenu>)

    await userEvent.pointer({ target: screen.getByText('scene'), keys: '[MouseRight]' })
    await userEvent.click(screen.getByRole('menuitem', { name: 'wireframe' }))

    expect(useViewerStore.getState().viewMode).toBe('wireframe')
  })
})
