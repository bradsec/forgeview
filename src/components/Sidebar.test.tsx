import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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

describe('Sidebar desktop variant', () => {
  beforeEach(() => {
    useViewerStore.setState({ sidebarVisible: false })
  })
  it('renders the hidden placeholder when sidebarVisible is false', () => {
    const { container } = render(<Sidebar />)
    expect(container.querySelector('aside.hidden')).toBeTruthy()
  })
})
