import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SolidEditorDialog } from './SolidEditorDialog'
import type { Viewer3DHandle } from './Viewer3D'
import { useViewerStore } from '../store/viewerStore'

describe('SolidEditorDialog', () => {
  beforeEach(() => useViewerStore.setState({ solidEditorOpen: true, error: null, notice: null }))

  it('reports worker progress and before/after mesh health', async () => {
    const makeSolid = vi.fn(async (onProgress: (percent: number, phase: string) => void) => {
      onProgress(45, 'Repairing mesh 1 of 1')
      onProgress(100, 'Repair complete')
      return {
        before: { triangles: 10, vertices: 8, boundaryEdges: 4, nonManifoldEdges: 0, duplicateFaces: 0, degenerateFaces: 0, watertight: false },
        after: { triangles: 12, vertices: 8, boundaryEdges: 0, nonManifoldEdges: 0, duplicateFaces: 0, degenerateFaces: 0, watertight: true },
        meshes: 1,
        shellsRemoved: 0,
      }
    })
    const viewerRef = { current: { makeSolid } as unknown as Viewer3DHandle }
    render(<SolidEditorDialog viewerRef={viewerRef} />)
    await userEvent.click(screen.getByRole('button', { name: 'Repair model' }))

    expect(await screen.findByText('Repair complete')).toBeTruthy()
    expect(screen.getByText('Watertight')).toBeTruthy()
    expect(screen.getByText('10 → 12')).toBeTruthy()
    expect(useViewerStore.getState().notice).toContain('repair applied')
  })
})
