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
  })
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
})

describe('Toolbar application menus', () => {
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
    expect(screen.getByText('Found forgeview useful? Support the creator.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Buy me a coffee' }).getAttribute('href')).toBe('https://buymeacoffee.com/markbradley')
  })
})
