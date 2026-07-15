import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ModelList } from './ModelList'
import { useViewerStore } from '../store/viewerStore'

describe('ModelList', () => {
  beforeEach(() => {
    useViewerStore.setState({
      filePath: 'cube.stl',
      fileName: 'cube.stl',
      fileExtension: '.stl',
      fileSize: 4,
      fileBuffer: new ArrayBuffer(4),
      triangleCount: 12,
      loadedModels: [],
    })
  })

  it('releases browser file bytes when removing the preview', () => {
    render(<ModelList />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove cube.stl' }))

    expect(useViewerStore.getState().fileBuffer).toBeNull()
  })
})
