import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as THREE from 'three'
import { ExportDialog } from './ExportDialog'
import type { Viewer3DHandle } from './Viewer3D'
import { useViewerStore } from '../store/viewerStore'
import { saveExportedFile } from '../services/saveFile'
import { collectExportMeshes, exportMeshes } from '../services/exporters'

vi.mock('../services/exporters', () => ({
  EXPORT_FORMATS: [{ format: '.stl', label: 'STL' }],
  collectExportMeshes: vi.fn(() => []),
  disposeExportMeshes: vi.fn(),
  exportMeshes: vi.fn(async () => new Uint8Array()),
}))
vi.mock('../utils/isTauri', () => ({ isTauri: () => false }))
vi.mock('../services/saveFile', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/saveFile')>(),
  saveExportedFile: vi.fn(async () => 'model.stl'),
}))

describe('ExportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useViewerStore.setState({ exportOpen: true, fileName: 'model.stl', pendingModelLoads: 0, error: null, exportTargetId: null })
  })

  afterEach(() => {
    delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker
  })

  it('opens the picker during the click before a slow export starts', async () => {
    let finishExport!: (bytes: Uint8Array) => void
    vi.mocked(exportMeshes).mockReturnValueOnce(new Promise((resolve) => { finishExport = resolve }))
    const handle = { name: 'chosen.stl', createWritable: vi.fn() }
    const picker = vi.fn().mockResolvedValue(handle)
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: picker })
    const viewerRef = { current: { getScene: () => new THREE.Scene() } as Viewer3DHandle }
    render(<ExportDialog viewerRef={viewerRef} />)

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(picker).toHaveBeenCalledOnce()
    expect(collectExportMeshes).not.toHaveBeenCalled()
    await waitFor(() => expect(exportMeshes).toHaveBeenCalledOnce())
    expect(saveExportedFile).not.toHaveBeenCalled()
    const bytes = new Uint8Array([1, 2])
    await act(async () => { finishExport(bytes) })
    await waitFor(() => expect(saveExportedFile).toHaveBeenCalledWith(bytes, 'model.stl', handle))
  })

  it.each([
    [{ name: 'AbortError' }, null],
    [new Error('Picker unavailable'), 'Picker unavailable'],
  ])('stops before processing when the picker rejects with %s', async (error, expectedError) => {
    const picker = vi.fn().mockRejectedValue(error)
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: picker })
    const viewerRef = { current: { getScene: () => new THREE.Scene() } as Viewer3DHandle }
    render(<ExportDialog viewerRef={viewerRef} />)

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(picker).toHaveBeenCalledOnce()
    await waitFor(() => expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(false))
    expect(collectExportMeshes).not.toHaveBeenCalled()
    expect(exportMeshes).not.toHaveBeenCalled()
    expect(saveExportedFile).not.toHaveBeenCalled()
    expect(useViewerStore.getState().exportOpen).toBe(true)
    expect(useViewerStore.getState().error).toBe(expectedError)
  })

  it('disables export while assembly models are loading', () => {
    useViewerStore.setState({ pendingModelLoads: 2 })
    const viewerRef = { current: { getScene: () => new THREE.Scene() } as Viewer3DHandle }
    render(<ExportDialog viewerRef={viewerRef} />)
    expect((screen.getByRole('button', { name: 'Loading models…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(collectExportMeshes).not.toHaveBeenCalled()
  })

  it('reports collection errors without starting export', async () => {
    vi.mocked(collectExportMeshes).mockImplementationOnce(() => { throw new Error('Unsupported deformation') })
    const viewerRef = { current: { getScene: () => new THREE.Scene() } as Viewer3DHandle }
    render(<ExportDialog viewerRef={viewerRef} />)
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(useViewerStore.getState().error).toBe('Unsupported deformation'))
  })

  it('passes the selected physical unit to 3MF export', async () => {
    const viewerRef = { current: { getScene: () => new THREE.Scene() } as Viewer3DHandle }
    render(<ExportDialog viewerRef={viewerRef} />)
    await userEvent.click(screen.getByRole('radio', { name: '3MF' }))
    await userEvent.selectOptions(screen.getByLabelText('3MF units'), 'inch')
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))

    await waitFor(() => expect(exportMeshes).toHaveBeenCalledWith([], '.3mf', { threeMFUnit: 'inch' }))
  })

  it('scopes export to a split part when exportTargetId is set', async () => {
    const part = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
    const getSplitPart = vi.fn(() => part)
    const getScene = vi.fn(() => new THREE.Scene())
    const viewerRef = { current: { getSplitPart, getScene } } as unknown as React.RefObject<Viewer3DHandle>
    useViewerStore.setState({
      exportOpen: true,
      exportTargetId: 'p1',
      splitParts: [{ id: 'p1', name: 'widget — part 1', triangleCount: 12, visible: true }],
      pendingModelLoads: 0,
    })
    render(<ExportDialog viewerRef={viewerRef} />)
    expect(screen.getByText(/widget — part 1/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /^export$/i }))
    expect(getSplitPart).toHaveBeenCalledWith('p1')
  })

  it('clears exportTargetId on close', async () => {
    useViewerStore.setState({ exportOpen: true, exportTargetId: 'p1' })
    const viewerRef = { current: { getScene: () => new THREE.Scene(), getSplitPart: () => undefined } } as unknown as React.RefObject<Viewer3DHandle>
    render(<ExportDialog viewerRef={viewerRef} />)
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(useViewerStore.getState().exportTargetId).toBeNull()
  })
})
