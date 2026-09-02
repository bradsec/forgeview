import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as THREE from 'three'
import { ExportDialog } from './ExportDialog'
import type { Viewer3DHandle } from './Viewer3D'
import { useViewerStore } from '../store/viewerStore'
import { collectExportMeshes, exportMeshes } from '../services/exporters'

vi.mock('../services/exporters', () => ({
  EXPORT_FORMATS: [{ format: '.stl', label: 'STL' }],
  collectExportMeshes: vi.fn(() => []),
  disposeExportMeshes: vi.fn(),
  exportMeshes: vi.fn(async () => new Uint8Array()),
}))
vi.mock('../services/saveFile', () => ({ saveExportedFile: vi.fn(async () => 'model.stl') }))

describe('ExportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useViewerStore.setState({ exportOpen: true, fileName: 'model.stl', pendingModelLoads: 0, error: null })
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
