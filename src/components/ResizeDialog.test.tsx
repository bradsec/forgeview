import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as THREE from 'three'
import { ResizeDialog } from './ResizeDialog'
import type { Viewer3DHandle } from './Viewer3D'
import { useViewerStore } from '../store/viewerStore'

describe('ResizeDialog', () => {
  const resizeModel = vi.fn()
  const viewerRef = { current: { getModelDimensions: () => new THREE.Vector3(100, 50, 25), resizeModel } as unknown as Viewer3DHandle }

  beforeEach(() => {
    resizeModel.mockClear()
    useViewerStore.setState({ resizeOpen: true, measurementUnit: 'mm', error: null })
  })

  it('updates linked dimensions and applies the requested size', async () => {
    render(<ResizeDialog viewerRef={viewerRef} />)
    const width = screen.getByRole('spinbutton', { name: 'width' })
    await userEvent.clear(width)
    await userEvent.type(width, '200')

    expect((screen.getByRole('spinbutton', { name: 'height' }) as HTMLInputElement).value).toBe('100')
    expect((screen.getByRole('spinbutton', { name: 'depth' }) as HTMLInputElement).value).toBe('50')
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(resizeModel).toHaveBeenCalledWith(200, 100, 50)
  })

  it('converts displayed values when units change without changing physical size', async () => {
    render(<ResizeDialog viewerRef={viewerRef} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Units' }), 'cm')
    expect((screen.getByRole('spinbutton', { name: 'width' }) as HTMLInputElement).value).toBe('10')
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(resizeModel).toHaveBeenCalledWith(100, 50, 25)
  })
})
