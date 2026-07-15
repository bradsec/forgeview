import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useViewerStore } from '../store/viewerStore'

vi.mock('../services/gridFiles', () => ({ listGridFiles: vi.fn() }))
vi.mock('./GridTile', () => ({
  GridTile: ({ file }: { file: { name: string } }) => <div data-testid="grid-tile">{file.name}</div>,
}))

import { listGridFiles } from '../services/gridFiles'
import { PreviewGrid } from './PreviewGrid'

describe('PreviewGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useViewerStore.setState({ gridFolder: '/many', gridScope: 'current', error: null })
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
