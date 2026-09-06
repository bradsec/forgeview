import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'
import { useViewerStore } from '../store/viewerStore'

describe('Sidebar mobile variant', () => {
  beforeEach(() => {
    useViewerStore.setState({
      sidebarVisible: false, mobileDrawer: 'details',
      fileName: null, fileExtension: null, fileSize: null, triangleCount: null,
      isLoading: false, error: null, loadedModels: [], filePath: null,
    })
  })

  it('renders content even though sidebarVisible is false', () => {
    render(<Sidebar mobile viewerRef={{ current: null }} />)
    expect(screen.getByText('Scene Models')).toBeTruthy()
  })

  it('close button clears the mobile drawer, not sidebarVisible', async () => {
    render(<Sidebar mobile viewerRef={{ current: null }} />)
    await userEvent.click(screen.getByRole('button', { name: /close sidebar/i }))
    expect(useViewerStore.getState().mobileDrawer).toBe('none')
    expect(useViewerStore.getState().sidebarVisible).toBe(false)
  })
})

describe('Sidebar geometry details', () => {
  const details = {
    width: 1, height: 1, depth: 1, meshes: 1, modelUnitInMm: null,
    vertices: 10, boundaryEdges: 9, nonManifoldEdges: 2, degenerateFaces: 0, duplicateFaces: 0, watertight: false,
    overhangFaceCount: 0, thinWallFaceCount: 0,
  }

  beforeEach(() => {
    useViewerStore.setState({
      sidebarVisible: false, mobileDrawer: 'details',
      fileName: 'model.stl', fileExtension: '.stl', fileSize: 10, triangleCount: 4,
      isLoading: false, error: null, loadedModels: [], filePath: '/m/model.stl',
    })
  })

  it('shows factual edge counts without a mesh health verdict', () => {
    useViewerStore.setState({ geometryDetails: details })
    render(<Sidebar mobile viewerRef={{ current: null }} />)
    expect(screen.getByText('Boundary edges')).toBeTruthy()
    expect(screen.getByText('Non-manifold')).toBeTruthy()
    expect(screen.queryByText('Mesh health')).toBeNull()
    expect(screen.queryByText('Needs repair')).toBeNull()
  })
})

describe('Sidebar desktop variant', () => {
  beforeEach(() => {
    useViewerStore.setState({ sidebarVisible: false })
  })
  it('renders the hidden placeholder when sidebarVisible is false', () => {
    const { container } = render(<Sidebar viewerRef={{ current: null }} />)
    expect(container.querySelector('aside.hidden')).toBeTruthy()
  })

  it('supports keyboard resizing when visible', async () => {
    useViewerStore.setState({ sidebarVisible: true })
    render(<Sidebar viewerRef={{ current: null }} />)

    const separator = screen.getByRole('separator', { name: 'Resize Details' })
    expect(separator.getAttribute('aria-valuenow')).toBe('256')
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(separator.getAttribute('aria-valuenow')).toBe('266')
  })

  it('removes active pointer resize listeners on unmount', () => {
    useViewerStore.setState({ sidebarVisible: true })
    const remove = vi.spyOn(document, 'removeEventListener')
    const { unmount } = render(<Sidebar viewerRef={{ current: null }} />)
    fireEvent.mouseDown(screen.getByRole('separator', { name: 'Resize Details' }), { clientX: 100 })

    unmount()

    expect(remove.mock.calls.some(([type]) => type === 'mousemove')).toBe(true)
    expect(remove.mock.calls.some(([type]) => type === 'mouseup')).toBe(true)
  })
})

describe('Sidebar tabs', () => {
  beforeEach(() => {
    useViewerStore.setState({
      sidebarVisible: true, mobileDrawer: 'none', rightPanelTab: 'details',
      fileName: 'model.stl', fileExtension: '.stl', fileSize: 10, triangleCount: 4,
      isLoading: false, error: null, loadedModels: [], filePath: '/m/model.stl',
      geometryDetails: null, canUndoEdit: false,
    })
  })

  it('shows the Details body by default', () => {
    render(<Sidebar viewerRef={{ current: null }} />)
    expect(screen.getByText('File Info')).toBeTruthy()
    expect(screen.queryByTestId('prepare-empty')).toBeNull()
  })

  it('switches to the Prepare body when the Prepare tab is clicked', async () => {
    render(<Sidebar viewerRef={{ current: null }} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Prepare' }))
    expect(useViewerStore.getState().rightPanelTab).toBe('prepare')
    expect(screen.getByTestId('prepare-empty')).toBeTruthy()
    expect(screen.queryByText('File Info')).toBeNull()
  })

  it('marks the active tab with aria-selected', async () => {
    render(<Sidebar viewerRef={{ current: null }} />)
    expect(screen.getByRole('tab', { name: 'Details' }).getAttribute('aria-selected')).toBe('true')
    await userEvent.click(screen.getByRole('tab', { name: 'Prepare' }))
    expect(screen.getByRole('tab', { name: 'Prepare' }).getAttribute('aria-selected')).toBe('true')
  })

  it('moves between tabs with Left/Right arrow keys', () => {
    render(<Sidebar viewerRef={{ current: null }} />)
    const detailsTab = screen.getByRole('tab', { name: 'Details' })
    detailsTab.focus()
    fireEvent.keyDown(detailsTab, { key: 'ArrowRight' })
    expect(useViewerStore.getState().rightPanelTab).toBe('prepare')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Prepare' }))
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Prepare' }), { key: 'ArrowLeft' })
    expect(useViewerStore.getState().rightPanelTab).toBe('details')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Details' }))
  })

  it('gives each mount unique tab ids', () => {
    const a = render(<Sidebar viewerRef={{ current: null }} />).container
    const b = render(<Sidebar mobile viewerRef={{ current: null }} />).container
    const idA = a.querySelector('[role="tab"]')?.getAttribute('id')
    const idB = b.querySelector('[role="tab"]')?.getAttribute('id')
    expect(idA).toBeTruthy()
    expect(idA).not.toBe(idB)
  })
})
