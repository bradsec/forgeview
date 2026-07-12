import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useViewerStore } from '../store/viewerStore'

// Mock Tauri plugin APIs before importing the module under test
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: vi.fn(),
  stat: vi.fn(),
}))

vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))

import { open } from '@tauri-apps/plugin-dialog'
import { readDir, stat } from '@tauri-apps/plugin-fs'
import { useDirOpen } from './useDirOpen'

describe('useDirOpen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // openDir branches on isTauri(); these tests cover the native dialog path
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    useViewerStore.setState({
      filePath: null,
      fileName: null,
      fileExtension: null,
      fileSize: null,
      viewMode: 'solid',
      isLoading: false,
      error: null,
      triangleCount: null,
      recentFiles: [],
      loadedModels: [],
      activeFilePath: null,
      dirPath: null,
      dirFiles: [],
      dirTree: [],
    })
  })

  it('does not call readDir or setDir when dialog is cancelled (returns null)', async () => {
    vi.mocked(open).mockResolvedValueOnce(null)

    const { openDir } = useDirOpen()
    await openDir()

    expect(readDir).not.toHaveBeenCalled()
    expect(useViewerStore.getState().dirPath).toBeNull()
    expect(useViewerStore.getState().dirFiles).toEqual([])
    expect(useViewerStore.getState().dirTree).toEqual([])
  })

  it('builds tree with directories and filtered files, and populates flat dirFiles', async () => {
    vi.mocked(open).mockResolvedValueOnce('/my/models')
    vi.mocked(readDir).mockResolvedValueOnce([
      { name: 'cube.stl', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'sphere.ply', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'notes.txt', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'subdir', isFile: false, isDirectory: true, isSymlink: false },
      { name: 'robot.obj', isFile: true, isDirectory: false, isSymlink: false },
    ] as any)
    vi.mocked(stat).mockResolvedValue({ size: 1024 } as any)

    const { openDir } = useDirOpen()
    await openDir()

    const state = useViewerStore.getState()
    expect(state.dirPath).toBe('/my/models')

    // Tree should have 4 entries: 1 dir + 3 files (txt excluded)
    expect(state.dirTree).toHaveLength(4)
    // Directories first
    expect(state.dirTree[0]).toMatchObject({
      name: 'subdir',
      isDirectory: true,
      isExpanded: false,
    })
    // Then files alphabetically
    expect(state.dirTree[1]).toMatchObject({ name: 'cube.stl', isDirectory: false })
    expect(state.dirTree[2]).toMatchObject({ name: 'robot.obj', isDirectory: false })
    expect(state.dirTree[3]).toMatchObject({ name: 'sphere.ply', isDirectory: false })

    // Flat dirFiles should have 3 files
    expect(state.dirFiles).toHaveLength(3)

    expect(useViewerStore.getState().gridFolder).toBe('/my/models')
    expect(useViewerStore.getState().mainView).toBe('grid')
  })

  it('calls setError when readDir throws an error', async () => {
    vi.mocked(open).mockResolvedValueOnce('/my/models')
    vi.mocked(readDir).mockRejectedValueOnce(new Error('Permission denied'))

    const { openDir } = useDirOpen()
    await openDir()

    expect(useViewerStore.getState().error).toBe('Permission denied')
    expect(useViewerStore.getState().dirPath).toBeNull()
  })
})
