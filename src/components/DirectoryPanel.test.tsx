import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useViewerStore } from '../store/viewerStore'
import { DirectoryPanel } from './DirectoryPanel'

// Mock useDirOpen hook
vi.mock('../hooks/useDirOpen', () => ({
  useDirOpen: () => ({
    openDir: vi.fn(),
    expandDir: vi.fn(),
    collapseDir: vi.fn(),
  }),
}))

describe('DirectoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      explorerVisible: true,
    })
  })

  it('returns null (renders nothing) when dirPath is null', () => {
    const { container } = render(<DirectoryPanel />)
    expect(container.firstChild).toBeNull()
  })

  it('shows "No supported files found" when dirPath is set but dirTree is empty', () => {
    useViewerStore.setState({ dirPath: '/empty/dir', dirTree: [] })
    render(<DirectoryPanel />)
    expect(screen.getByText('No supported files found')).toBeTruthy()
  })

  it('renders file entries with correct name, extension badge, and formatted size', () => {
    useViewerStore.setState({
      dirPath: '/my/models',
      dirTree: [
        { name: 'cube.stl', fullPath: '/my/models/cube.stl', isDirectory: false, extension: '.stl', sizeBytes: 1536 },
        { name: 'sphere.ply', fullPath: '/my/models/sphere.ply', isDirectory: false, extension: '.ply', sizeBytes: 2097152 },
      ],
    })
    render(<DirectoryPanel />)

    expect(screen.getByText('cube.stl')).toBeTruthy()
    expect(screen.getByText('sphere.ply')).toBeTruthy()
    expect(screen.getByText('STL')).toBeTruthy()
    expect(screen.getByText('PLY')).toBeTruthy()
    expect(screen.getByText('1.5 KB')).toBeTruthy()
    expect(screen.getByText('2.0 MB')).toBeTruthy()
  })

  it('renders directory entries with folder indicator', () => {
    useViewerStore.setState({
      dirPath: '/my/models',
      dirTree: [
        { name: 'subdir', fullPath: '/my/models/subdir', isDirectory: true, isExpanded: false, isLoaded: false, children: [] },
        { name: 'cube.stl', fullPath: '/my/models/cube.stl', isDirectory: false, extension: '.stl', sizeBytes: 1024 },
      ],
    })
    render(<DirectoryPanel />)

    expect(screen.getByText('subdir')).toBeTruthy()
    expect(screen.getByText('cube.stl')).toBeTruthy()
  })

  it('calls setFile and setActiveFile when a file is clicked', () => {
    useViewerStore.setState({
      dirPath: '/my/models',
      dirTree: [
        { name: 'cube.stl', fullPath: '/my/models/cube.stl', isDirectory: false, extension: '.stl', sizeBytes: 1024 },
      ],
    })
    render(<DirectoryPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Open file cube.stl' }))

    const state = useViewerStore.getState()
    expect(state.filePath).toBe('/my/models/cube.stl')
    expect(state.fileName).toBe('cube.stl')
    expect(state.fileExtension).toBe('.stl')
    expect(state.fileSize).toBe(1024)
    expect(state.activeFilePath).toBe('/my/models/cube.stl')
  })

  it('applies blue highlight class to the active file entry', () => {
    useViewerStore.setState({
      dirPath: '/my/models',
      dirTree: [
        { name: 'cube.stl', fullPath: '/my/models/cube.stl', isDirectory: false, extension: '.stl', sizeBytes: 1024 },
        { name: 'sphere.ply', fullPath: '/my/models/sphere.ply', isDirectory: false, extension: '.ply', sizeBytes: 2048 },
      ],
      activeFilePath: '/my/models/cube.stl',
    })
    render(<DirectoryPanel />)

    const cubeLi = screen.getByText('cube.stl').closest('li')!
    const sphereLi = screen.getByText('sphere.ply').closest('li')!

    expect(cubeLi.className).toContain('bg-[var(--bg-button-active)]')
    expect(sphereLi.className).not.toContain('bg-[var(--bg-button-active)]')
  })

  it('renders large directories in pages', async () => {
    useViewerStore.setState({
      dirPath: '/many',
      dirTree: Array.from({ length: 101 }, (_, index) => ({
        name: `part-${index}.stl`,
        fullPath: `/many/part-${index}.stl`,
        isDirectory: false,
        extension: '.stl',
        sizeBytes: 1,
      })),
    })
    render(<DirectoryPanel />)

    expect(screen.queryByText('part-100.stl')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Load more (1 remaining)' }))
    expect(screen.getByText('part-100.stl')).toBeTruthy()
  })

  it('supports keyboard resizing', async () => {
    useViewerStore.setState({ dirPath: '/models', dirTree: [] })
    render(<DirectoryPanel />)

    const separator = screen.getByRole('separator', { name: 'Resize Explorer' })
    expect(separator.getAttribute('aria-valuenow')).toBe('224')
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(separator.getAttribute('aria-valuenow')).toBe('234')
  })
})

describe('DirectoryPanel mobile variant', () => {
  beforeEach(() => {
    useViewerStore.setState({
      dirPath: '/m', dirTree: [], explorerVisible: false, mobileDrawer: 'explorer',
    })
  })

  it('renders when dirPath is set even though explorerVisible is false', () => {
    render(<DirectoryPanel mobile />)
    expect(screen.getByText('Explorer')).toBeTruthy()
  })

  it('close button clears the mobile drawer, not explorerVisible', async () => {
    render(<DirectoryPanel mobile />)
    await userEvent.click(screen.getByRole('button', { name: /close explorer/i }))
    expect(useViewerStore.getState().mobileDrawer).toBe('none')
    expect(useViewerStore.getState().explorerVisible).toBe(false)
  })
})
