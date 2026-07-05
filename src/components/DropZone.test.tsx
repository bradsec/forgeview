import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: vi.fn(() => ({
    onDragDropEvent: vi.fn(async () => () => {}),
  })),
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
  stat: vi.fn(),
}))

import { DropZone } from './DropZone'
import { useViewerStore } from '../store/viewerStore'

// jsdom has no __TAURI_INTERNALS__, so DropZone runs in browser mode

describe('DropZone browser drag-and-drop fallback', () => {
  beforeEach(() => {
    useViewerStore.setState({
      filePath: null,
      fileName: null,
      fileExtension: null,
      fileSize: null,
      fileBuffer: null,
      error: null,
      mainView: 'grid',
    })
  })

  it('loads a dropped supported file into the store', async () => {
    render(<DropZone />)
    const zone = screen.getByTestId('dropzone')
    const file = new File(['solid t\nendsolid t\n'], 'cube.stl', { type: 'model/stl' })

    fireEvent.drop(zone, { dataTransfer: { files: [file] } })

    await waitFor(() => {
      const state = useViewerStore.getState()
      expect(state.filePath).toBe('cube.stl')
      expect(state.fileExtension).toBe('.stl')
      expect(state.fileBuffer).not.toBeNull()
      expect(state.mainView).toBe('3d')
    })
  })

  it('sets an error for unsupported extensions', async () => {
    render(<DropZone />)
    const zone = screen.getByTestId('dropzone')
    const file = new File(['nope'], 'readme.txt', { type: 'text/plain' })

    fireEvent.drop(zone, { dataTransfer: { files: [file] } })

    await waitFor(() => {
      expect(useViewerStore.getState().error).toBe('Unsupported format: .txt')
      expect(useViewerStore.getState().filePath).toBeNull()
    })
  })

  it('highlights on dragover and clears on dragleave', () => {
    render(<DropZone />)
    const zone = screen.getByTestId('dropzone')

    fireEvent.dragOver(zone, { dataTransfer: { files: [] } })
    expect(zone.className).toContain('ring-2')

    fireEvent.dragLeave(zone)
    expect(zone.className).not.toContain('ring-2')
  })
})
