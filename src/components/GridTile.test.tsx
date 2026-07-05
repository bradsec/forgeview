import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GridTile } from './GridTile'
import { useViewerStore } from '../store/viewerStore'
import type { GridFile } from '../services/gridFiles'
import type { ThumbnailQueue, ThumbEntry } from '../services/thumbnailService'

const file: GridFile = { name: 'cube.stl', path: '/m/cube.stl', extension: '.stl', size: 2048, mtime: 1 }

beforeEach(() => {
  ;(globalThis as any).IntersectionObserver = class {
    cb: (entries: any[]) => void
    constructor(cb: (entries: any[]) => void) { this.cb = cb }
    observe() { this.cb([{ isIntersecting: true }]) }
    unobserve() {}
    disconnect() {}
  }
  useViewerStore.setState({
    filePath: null, fileName: null, fileExtension: null, fileSize: null,
    mainView: 'grid', loadedModels: [],
  })
})

const makeQueue = (entry: ThumbEntry): ThumbnailQueue => ({
  request: vi.fn(async () => entry),
  get: vi.fn(() => undefined),
})

describe('GridTile', () => {
  it('shows the image when the thumbnail resolves', async () => {
    render(<GridTile file={file} queue={makeQueue({ status: 'ready', dataUrl: 'data:abc' })} />)
    await waitFor(() => {
      const img = screen.getByRole('img') as HTMLImageElement
      expect(img.src).toContain('data:abc')
    })
  })

  it('shows a placeholder on error', async () => {
    render(<GridTile file={file} queue={makeQueue({ status: 'error' })} />)
    await waitFor(() => expect(screen.getByText(/preview unavailable/i)).toBeTruthy())
  })

  it('click loads the file as preview and switches to 3d', async () => {
    render(<GridTile file={file} queue={makeQueue({ status: 'ready', dataUrl: 'data:abc' })} />)
    await userEvent.click(screen.getByRole('button', { name: /open cube\.stl/i }))
    const s = useViewerStore.getState()
    expect(s.filePath).toBe('/m/cube.stl')
    expect(s.mainView).toBe('3d')
  })

  it('add button adds the file to the scene', async () => {
    render(<GridTile file={file} queue={makeQueue({ status: 'ready', dataUrl: 'data:abc' })} />)
    await userEvent.click(screen.getByRole('button', { name: /add cube\.stl to scene/i }))
    expect(useViewerStore.getState().loadedModels.map((m) => m.path)).toContain('/m/cube.stl')
  })

  it('shows the skeleton while pending and not the image or error', () => {
    // queue.request never resolves -> stays pending
    const queue = { request: vi.fn(() => new Promise<never>(() => {})), get: vi.fn(() => undefined) }
    const { container } = render(<GridTile file={file} queue={queue as any} />)
    expect(container.querySelector('.animate-pulse')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByText(/preview unavailable/i)).toBeNull()
  })
})
