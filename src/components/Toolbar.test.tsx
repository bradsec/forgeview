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
})

const mobile = () => within(screen.getByTestId('toolbar-mobile'))

describe('Toolbar mobile row', () => {
  it('hamburger opens the explorer drawer', async () => {
    render(<Toolbar />)
    await userEvent.click(mobile().getByRole('button', { name: /explorer/i }))
    expect(useViewerStore.getState().mobileDrawer).toBe('explorer')
  })

  it('details button opens the details drawer', async () => {
    render(<Toolbar />)
    await userEvent.click(mobile().getByRole('button', { name: /details/i }))
    expect(useViewerStore.getState().mobileDrawer).toBe('details')
  })

  it('file menu opens and closes after choosing Open', async () => {
    render(<Toolbar />)
    await userEvent.click(mobile().getByRole('button', { name: /^more/i }))
    const menu = screen.getByTestId('toolbar-menu')
    await userEvent.click(within(menu).getByRole('menuitem', { name: /^open$/i }))
    expect(screen.queryByTestId('toolbar-menu')).toBeNull()
  })

  it('hamburger closes the explorer drawer when already open', async () => {
    useViewerStore.setState({ mobileDrawer: 'explorer' })
    render(<Toolbar />)
    await userEvent.click(mobile().getByRole('button', { name: /explorer/i }))
    expect(useViewerStore.getState().mobileDrawer).toBe('none')
  })

  it('Escape closes the overflow menu', async () => {
    render(<Toolbar />)
    const trigger = mobile().getByRole('button', { name: /^more/i })
    await userEvent.click(trigger)
    expect(screen.getByTestId('toolbar-menu')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('toolbar-menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
