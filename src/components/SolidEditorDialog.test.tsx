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
        gpuAssisted: true,
        strippedWalls: false,
      }
    })
    const viewerRef = { current: { makeSolid } as unknown as Viewer3DHandle }
    render(<SolidEditorDialog viewerRef={viewerRef} />)
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(makeSolid).toHaveBeenCalledWith(128, expect.any(Function), expect.any(AbortSignal), { stripInternalWalls: false })
    expect(await screen.findByText('Solid fill complete')).toBeTruthy()
    expect(screen.getByText('Interior removed, 4 open edges left')).toBeTruthy()
    expect(screen.getByText('100 → 40')).toBeTruthy()
    expect(screen.getByText('3 → 1')).toBeTruthy()
    expect(useViewerStore.getState().notice).toContain('Make solid applied')
  })

  it('reports a watertight result when the kept surface is closed', async () => {
    const makeSolid = vi.fn(async (_resolution: number, onProgress: (percent: number, phase: string) => void) => {
      onProgress(100, 'Solid fill complete')
      return {
        before: { triangles: 24, vertices: 14, boundaryEdges: 0, nonManifoldEdges: 0, duplicateFaces: 0, degenerateFaces: 0, watertight: false },
        after: { triangles: 12, vertices: 8, boundaryEdges: 0, nonManifoldEdges: 0, duplicateFaces: 0, degenerateFaces: 0, watertight: true },
        meshes: 2,
        resolution: 128,
        gpuAssisted: true,
        strippedWalls: false,
      }
    })
    const viewerRef = { current: { makeSolid } as unknown as Viewer3DHandle }
    render(<SolidEditorDialog viewerRef={viewerRef} />)
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(await screen.findByText('Watertight solid')).toBeTruthy()
    expect(screen.getByText('24 → 12')).toBeTruthy()
  })

  it('reports a sealed (no open edges) result that is not strictly watertight', async () => {
    const makeSolid = vi.fn(async (_r: number, onProgress: (p: number, s: string) => void) => {
      onProgress(100, 'Solid fill complete')
      return {
        before: { triangles: 100, vertices: 60, boundaryEdges: 20, nonManifoldEdges: 8, duplicateFaces: 0, degenerateFaces: 0, watertight: false },
        after: { triangles: 96, vertices: 58, boundaryEdges: 0, nonManifoldEdges: 7, duplicateFaces: 0, degenerateFaces: 0, watertight: false },
        meshes: 1,
        resolution: 128,
        gpuAssisted: true,
        strippedWalls: false,
      }
    })
    const viewerRef = { current: { makeSolid } as unknown as Viewer3DHandle }
    render(<SolidEditorDialog viewerRef={viewerRef} />)
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByText('Sealed solid, no open edges')).toBeTruthy()
  })

  it('disables internal-wall removal when WebGL is unavailable', async () => {
    // jsdom has no webgl2 context.
    const makeSolid = vi.fn(async (_r: number, onProgress: (p: number, s: string) => void) => {
      onProgress(100, 'Solid fill complete')
      return {
        before: { triangles: 24, vertices: 14, boundaryEdges: 0, nonManifoldEdges: 0, duplicateFaces: 0, degenerateFaces: 0, watertight: false },
        after: { triangles: 12, vertices: 8, boundaryEdges: 0, nonManifoldEdges: 0, duplicateFaces: 0, degenerateFaces: 0, watertight: true },
        meshes: 1, resolution: 128, gpuAssisted: false, strippedWalls: false,
      }
    })
    const viewerRef = { current: { makeSolid } as unknown as Viewer3DHandle }
    render(<SolidEditorDialog viewerRef={viewerRef} />)

    const checkbox = screen.getByRole('checkbox', { name: /Remove internal walls/ }) as HTMLInputElement
    expect(checkbox.disabled).toBe(true)
    expect(screen.getByText(/Needs WebGL/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(makeSolid).toHaveBeenCalledWith(128, expect.any(Function), expect.any(AbortSignal), { stripInternalWalls: false })
  })

  it('warns when the solid fill ran without GPU visibility', async () => {
    const makeSolid = vi.fn(async (_resolution: number, onProgress: (percent: number, phase: string) => void) => {
      onProgress(100, 'Solid fill complete')
      return {
        before: { triangles: 24, vertices: 14, boundaryEdges: 0, nonManifoldEdges: 0, duplicateFaces: 0, degenerateFaces: 0, watertight: false },
        after: { triangles: 12, vertices: 8, boundaryEdges: 0, nonManifoldEdges: 0, duplicateFaces: 0, degenerateFaces: 0, watertight: true },
        meshes: 1,
        resolution: 128,
        gpuAssisted: false,
        strippedWalls: false,
      }
    })
    const viewerRef = { current: { makeSolid } as unknown as Viewer3DHandle }
    render(<SolidEditorDialog viewerRef={viewerRef} />)
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(await screen.findByText(/WebGL was unavailable/)).toBeTruthy()
  })
})
