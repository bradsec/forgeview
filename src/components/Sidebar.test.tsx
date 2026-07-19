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
    render(<Sidebar mobile />)
    expect(screen.getByText('Scene Models')).toBeTruthy()
  })

  it('close button clears the mobile drawer, not sidebarVisible', async () => {
    render(<Sidebar mobile />)
    await userEvent.click(screen.getByRole('button', { name: /close sidebar/i }))
    expect(useViewerStore.getState().mobileDrawer).toBe('none')
    expect(useViewerStore.getState().sidebarVisible).toBe(false)
  })
})

describe('Sidebar geometry details', () => {
  const details = {
    width: 1, height: 1, depth: 1, meshes: 1, modelUnitInMm: null,
    vertices: 10, boundaryEdges: 9, nonManifoldEdges: 2, watertight: false,
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
    render(<Sidebar mobile />)
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
    const { container } = render(<Sidebar />)
    expect(container.querySelector('aside.hidden')).toBeTruthy()
  })

  it('supports keyboard resizing when visible', async () => {
    useViewerStore.setState({ sidebarVisible: true })
    render(<Sidebar />)

    const separator = screen.getByRole('separator', { name: 'Resize Details' })
    expect(separator.getAttribute('aria-valuenow')).toBe('256')
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(separator.getAttribute('aria-valuenow')).toBe('266')
  })

  it('removes active pointer resize listeners on unmount', () => {
    useViewerStore.setState({ sidebarVisible: true })
    const remove = vi.spyOn(document, 'removeEventListener')
    const { unmount } = render(<Sidebar />)
    fireEvent.mouseDown(screen.getByRole('separator', { name: 'Resize Details' }), { clientX: 100 })

    unmount()

    expect(remove.mock.calls.some(([type]) => type === 'mousemove')).toBe(true)
    expect(remove.mock.calls.some(([type]) => type === 'mouseup')).toBe(true)
  })
})
