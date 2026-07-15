import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsModal } from './SettingsModal'
import { useViewerStore } from '../store/viewerStore'

describe('SettingsModal', () => {
  beforeEach(() => {
    useViewerStore.setState({ settingsOpen: true })
  })

  it('announces a modal dialog and closes on Escape', async () => {
    render(<SettingsModal />)
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()

    await userEvent.keyboard('{Escape}')

    expect(useViewerStore.getState().settingsOpen).toBe(false)
  })
})
