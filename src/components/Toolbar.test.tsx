import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toolbar } from './Toolbar'
import { useViewerStore } from '../store/viewerStore'

vi.mock('../hooks/useFileOpen', () => ({ useFileOpen: () => ({ openFile: vi.fn() }) }))
vi.mock('../hooks/useDirOpen', () => ({ useDirOpen: () => ({ openDir: vi.fn() }) }))

beforeEach(() => {
  useViewerStore.setState({
    viewMode: 'solid', dirPath: '/m', mainView: 'grid',
    explorerVisible: true, sidebarVisible: true, theme: 'dark', mobileDrawer: 'none',
    rightPanelTab: 'details',
  })
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
})

describe('Toolbar application menus', () => {
  it('switches from Prepare to Details without hiding the inspector', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
    useViewerStore.setState({ sidebarVisible: true, rightPanelTab: 'prepare' })
    render(<Toolbar />)
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
    await userEvent.click(within(screen.getByTestId('toolbar-view-menu')).getByRole('menuitem', { name: 'Details' }))
    expect(useViewerStore.getState().sidebarVisible).toBe(true)
    expect(useViewerStore.getState().rightPanelTab).toBe('details')
  })

  it('has no Edit menu', () => {
    render(<Toolbar />)
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('Prepare button opens the Prepare tab on a wide viewport', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
    useViewerStore.setState({ filePath: '/m/model.stl', sidebarVisible: false, rightPanelTab: 'details' })
    render(<Toolbar />)
    await userEvent.click(screen.getByRole('button', { name: 'Prepare' }))
    expect(useViewerStore.getState().rightPanelTab).toBe('prepare')
    expect(useViewerStore.getState().sidebarVisible).toBe(true)
  })

  it('View menu opens the details drawer via Prepare on a narrow viewport', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    useViewerStore.setState({ filePath: '/m/model.stl', mobileDrawer: 'none', rightPanelTab: 'details' })
    render(<Toolbar />)
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
    await userEvent.click(within(screen.getByTestId('toolbar-view-menu')).getByRole('menuitem', { name: 'Prepare' }))
    expect(useViewerStore.getState().rightPanelTab).toBe('prepare')
    expect(useViewerStore.getState().mobileDrawer).toBe('details')
  })

  it('marks Prepare only while its mobile drawer is visible', async () => {
    useViewerStore.setState({ sidebarVisible: true, mobileDrawer: 'none', rightPanelTab: 'prepare' })
    render(<Toolbar />)
    expect(screen.getByRole('button', { name: 'Prepare' }).getAttribute('aria-pressed')).toBe('false')
    await userEvent.click(screen.getByRole('button', { name: 'Prepare' }))
    expect(screen.getByRole('button', { name: 'Prepare' }).getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
    await userEvent.click(within(screen.getByTestId('toolbar-view-menu')).getByRole('menuitem', { name: 'Details' }))
    expect(useViewerStore.getState().rightPanelTab).toBe('details')
    expect(screen.getByRole('button', { name: 'Details' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('shows a Prepare item in the View menu', async () => {
    render(<Toolbar />)
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
    expect(within(screen.getByTestId('toolbar-view-menu')).getByRole('menuitem', { name: 'Prepare' })).toBeTruthy()
  })
  it('opens and closes the File menu after choosing Open file', async () => {
    render(<Toolbar />)
    await userEvent.click(screen.getByRole('button', { name: 'File' }))
    const menu = screen.getByTestId('toolbar-file-menu')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Open file' }))
    expect(screen.queryByTestId('toolbar-file-menu')).toBeNull()
  })

  it('opens the explorer drawer from View on a narrow viewport', async () => {
    render(<Toolbar />)
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
    await userEvent.click(within(screen.getByTestId('toolbar-view-menu')).getByRole('menuitem', { name: 'Explorer' }))
    expect(useViewerStore.getState().mobileDrawer).toBe('explorer')
  })

  it('opens the details drawer from View on a narrow viewport', async () => {
    render(<Toolbar />)
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
    await userEvent.click(within(screen.getByTestId('toolbar-view-menu')).getByRole('menuitem', { name: 'Details' }))
    expect(useViewerStore.getState().mobileDrawer).toBe('details')
  })

  it('changes display mode from the View menu', async () => {
    render(<Toolbar />)
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
    await userEvent.click(within(screen.getByTestId('toolbar-view-menu')).getByRole('menuitem', { name: 'Wireframe' }))
    expect(useViewerStore.getState().viewMode).toBe('wireframe')
  })

  it('Escape closes a menu and restores focus', async () => {
    render(<Toolbar />)
    const trigger = screen.getByRole('button', { name: 'File' })
    await userEvent.click(trigger)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('toolbar-file-menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('opens About from Help', async () => {
    render(<Toolbar />)
    await userEvent.click(screen.getByRole('button', { name: 'Help' }))
    await userEvent.click(within(screen.getByTestId('toolbar-help-menu')).getByRole('menuitem', { name: 'About Forgeview' }))
    expect(screen.getByRole('dialog', { name: 'About forgeview' })).toBeTruthy()
    expect(screen.getByText('View forgeview on GitHub')).toBeTruthy()
    expect(screen.getByText('If you find this useful, please consider starring the repository. It helps others discover the project.')).toBeTruthy()
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('the Help menu opens the feature guide', async () => {
    render(<Toolbar />)
    await userEvent.click(screen.getByRole('button', { name: 'Help' }))
    await userEvent.click(within(screen.getByTestId('toolbar-help-menu')).getByRole('menuitem', { name: 'Feature guide' }))
    expect(useViewerStore.getState().helpOpen).toBe(true)
  })
})
