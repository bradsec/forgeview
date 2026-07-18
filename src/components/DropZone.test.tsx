import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, renderHook } from '@testing-library/react'

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
import { useGlobalFileDrop } from '../hooks/useGlobalFileDrop'
import { useViewerStore } from '../store/viewerStore'

// jsdom has no __TAURI_INTERNALS__, so the hook runs in browser mode with
// window-level drag listeners

describe('useGlobalFileDrop browser drag-and-drop', () => {
  beforeEach(() => {
    useViewerStore.setState({
      filePath: null,
      fileName: null,
      fileExtension: null,
      fileSize: null,
      fileBuffer: null,
      error: null,
      isDragOver: false,
      mainView: 'grid',
    })
  })

  it('loads a dropped supported file into the store', async () => {
    renderHook(() => useGlobalFileDrop())
    const file = new File(['solid t\nendsolid t\n'], 'cube.stl', { type: 'model/stl' })

    fireEvent.drop(window, { dataTransfer: { files: [file] } })

    await waitFor(() => {
      const state = useViewerStore.getState()
      expect(state.filePath).toBe('cube.stl')
      expect(state.fileExtension).toBe('.stl')
      expect(state.fileBuffer).not.toBeNull()
      expect(state.mainView).toBe('3d')
    })
  })

  it('works while a model is already open (drop replaces it)', async () => {
    useViewerStore.setState({ filePath: 'old.stl', fileName: 'old.stl', fileExtension: '.stl', mainView: '3d' })
    renderHook(() => useGlobalFileDrop())
    const file = new File(['solid t\nendsolid t\n'], 'next.stl', { type: 'model/stl' })

    fireEvent.drop(window, { dataTransfer: { files: [file] } })

    await waitFor(() => {
      expect(useViewerStore.getState().filePath).toBe('next.stl')
    })
  })

  it('sets an error for unsupported extensions', async () => {
    renderHook(() => useGlobalFileDrop())
    const file = new File(['nope'], 'readme.txt', { type: 'text/plain' })

    fireEvent.drop(window, { dataTransfer: { files: [file] } })

    await waitFor(() => {
      expect(useViewerStore.getState().error).toBe('Unsupported format: .txt')
      expect(useViewerStore.getState().filePath).toBeNull()
    })
  })

  it('tracks drag-over state and DropZone highlights from it', () => {
    renderHook(() => useGlobalFileDrop())
    render(<DropZone />)
    const zone = screen.getByTestId('dropzone')

    fireEvent.dragOver(window, { dataTransfer: { files: [] } })
    expect(useViewerStore.getState().isDragOver).toBe(true)
    expect(zone.className).toContain('ring-2')

    fireEvent.dragLeave(window)
    expect(useViewerStore.getState().isDragOver).toBe(false)
    expect(zone.className).not.toContain('ring-2')
  })
})
