import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SolidEditorDialog } from './SolidEditorDialog'
import type { Viewer3DHandle } from './Viewer3D'
import { useViewerStore } from '../store/viewerStore'

describe('SolidEditorDialog', () => {
  beforeEach(() => useViewerStore.setState({ solidEditorOpen: true, error: null, notice: null }))

  it('reports worker progress and the interior-removal outcome', async () => {
    const makeSolid = vi.fn(async (_resolution: number, onProgress: (percent: number, phase: string) => void) => {
      onProgress(45, 'Classifying triangles')
      onProgress(100, 'Solid fill complete')
      return {
        before: { triangles: 100, vertices: 60, boundaryEdges: 4, nonManifoldEdges: 2, duplicateFaces: 0, degenerateFaces: 0, watertight: false },
        after: { triangles: 40, vertices: 24, boundaryEdges: 4, nonManifoldEdges: 0, duplicateFaces: 0, degenerateFaces: 0, watertight: false },
        meshes: 3,
        resolution: 128,
      }
    })
    const viewerRef = { current: { makeSolid } as unknown as Viewer3DHandle }
    render(<SolidEditorDialog viewerRef={viewerRef} />)
    await userEvent.click(screen.getByRole('button', { name: 'Repair model' }))

    expect(makeSolid).toHaveBeenCalledWith(128, expect.any(Function), expect.any(AbortSignal))
    expect(await screen.findByText('Solid fill complete')).toBeTruthy()
    expect(screen.getByText('Interior removed, exterior kept')).toBeTruthy()
    expect(screen.getByText('100 → 40')).toBeTruthy()
    expect(screen.getByText('3 → 1')).toBeTruthy()
    expect(useViewerStore.getState().notice).toContain('repair applied')
  })

  it('reports a watertight result when the kept surface is closed', async () => {
    const makeSolid = vi.fn(async (_resolution: number, onProgress: (percent: number, phase: string) => void) => {
      onProgress(100, 'Solid fill complete')
      return {
        before: { triangles: 24, vertices: 14, boundaryEdges: 0, nonManifoldEdges: 0, duplicateFaces: 0, degenerateFaces: 0, watertight: false },
        after: { triangles: 12, vertices: 8, boundaryEdges: 0, nonManifoldEdges: 0, duplicateFaces: 0, degenerateFaces: 0, watertight: true },
        meshes: 2,
        resolution: 128,
      }
    })
    const viewerRef = { current: { makeSolid } as unknown as Viewer3DHandle }
    render(<SolidEditorDialog viewerRef={viewerRef} />)
    await userEvent.click(screen.getByRole('button', { name: 'Repair model' }))

    expect(await screen.findByText('Watertight solid')).toBeTruthy()
    expect(screen.getByText('24 → 12')).toBeTruthy()
  })
})
