import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HelpModal } from './HelpModal'
import { useViewerStore } from '../store/viewerStore'

describe('HelpModal', () => {
  beforeEach(() => useViewerStore.setState({ helpOpen: false }))

  it('renders nothing when closed', () => {
    render(<HelpModal />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders the guide with a section per tool when open', () => {
    useViewerStore.setState({ helpOpen: true })
    render(<HelpModal />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Repair' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Overhang heatmap' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Measure' })).toBeTruthy()
  })

  it('the Close button closes it', async () => {
    useViewerStore.setState({ helpOpen: true })
    render(<HelpModal />)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(useViewerStore.getState().helpOpen).toBe(false)
  })

  it('Escape closes it', async () => {
    useViewerStore.setState({ helpOpen: true })
    render(<HelpModal />)
    await userEvent.keyboard('{Escape}')
    expect(useViewerStore.getState().helpOpen).toBe(false)
  })
})
