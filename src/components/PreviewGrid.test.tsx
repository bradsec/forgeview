import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useViewerStore } from '../store/viewerStore'

vi.mock('../services/gridFiles', () => ({ listGridFiles: vi.fn() }))
vi.mock('./GridTile', () => ({
  GridTile: ({ file }: { file: { name: string } }) => <div data-testid="grid-tile">{file.name}</div>,
}))

import { listGridFiles } from '../services/gridFiles'
import { PreviewGrid, sortGridFiles } from './PreviewGrid'

describe('sortGridFiles', () => {
  const files = [
    { name: 'b.stl', path: '/b.stl', extension: '.stl', size: 10, mtime: 300 },
    { name: 'a.stl', path: '/a.stl', extension: '.stl', size: 30, mtime: 100 },
    { name: 'c.stl', path: '/c.stl', extension: '.stl', size: 20, mtime: 200 },
  ]

  it('sorts by name ascending', () => {
    expect(sortGridFiles(files, 'name').map((f) => f.name)).toEqual(['a.stl', 'b.stl', 'c.stl'])
  })
  it('sorts by size descending', () => {
    expect(sortGridFiles(files, 'size').map((f) => f.name)).toEqual(['a.stl', 'c.stl', 'b.stl'])
  })
  it('sorts by mtime descending', () => {
    expect(sortGridFiles(files, 'mtime').map((f) => f.name)).toEqual(['b.stl', 'c.stl', 'a.stl'])
  })
  it('does not mutate the input array', () => {
    const input = [...files]
    sortGridFiles(input, 'size')
    expect(input).toEqual(files)
  })
})

describe('PreviewGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useViewerStore.setState({ gridFolder: '/many', gridScope: 'current', gridSort: 'name', dirPath: '/many', error: null })
  })

  it('shows breadcrumbs in subfolders and navigates back up', async () => {
    vi.mocked(listGridFiles).mockResolvedValue({ folders: [], files: [] })
    useViewerStore.setState({ dirPath: '/many', gridFolder: '/many/sub' })
    render(<PreviewGrid />)

    const rootCrumb = await screen.findByRole('button', { name: 'many' })
    expect(screen.getByText('sub')).toBeTruthy()
    await userEvent.click(rootCrumb)
    expect(useViewerStore.getState().gridFolder).toBe('/many')
  })

  it('renders large listings in pages', async () => {
    vi.mocked(listGridFiles).mockResolvedValue({
      folders: [],
      files: Array.from({ length: 61 }, (_, index) => ({
        name: `part-${index}.stl`,
        path: `/many/part-${index}.stl`,
        extension: '.stl',
        size: 1,
        mtime: 1,
      })),
    })
    render(<PreviewGrid />)

    await waitFor(() => expect(screen.getAllByTestId('grid-tile')).toHaveLength(60))
    await userEvent.click(screen.getByRole('button', { name: 'Load more (1 remaining)' }))
    expect(screen.getAllByTestId('grid-tile')).toHaveLength(61)
  })
})
