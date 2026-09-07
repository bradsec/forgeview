import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransformSection } from './TransformSection'
import { useViewerStore } from '../../store/viewerStore'

const details = {
  width: 10, height: 10, depth: 10, vertices: 1, meshes: 1,
  boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
  watertight: true, modelUnitInMm: 1, overhangFaceCount: 0, thinWallFaceCount: 0,
}

describe('TransformSection', () => {
  beforeEach(() =>
    useViewerStore.setState({
      geometryDetails: details, measurementUnit: 'mm', splitParts: [], measureMode: false,
    }),
  )

  it('locks every control while split by shell', () => {
    useViewerStore.setState({ splitParts: [{ id: 'a', name: 'a', triangleCount: 1, visible: true }] })
    render(<TransformSection viewerRef={{ current: null }} />)
    expect((screen.getByRole('button', { name: 'Apply move' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Mirror Y' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Drop to floor' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables Apply move until an axis has a value', async () => {
    render(<TransformSection viewerRef={{ current: null }} />)
    expect((screen.getByRole('button', { name: 'Apply move' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.type(screen.getByLabelText('Move x'), '5')
    expect((screen.getByRole('button', { name: 'Apply move' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('converts move mm to a raw-unit delta, leaves untouched axes at 0, and resets the inputs', async () => {
    const moveModelBy = vi.fn()
    render(<TransformSection viewerRef={{ current: { moveModelBy } as never }} />)
    await userEvent.type(screen.getByLabelText('Move x'), '10')
    await userEvent.click(screen.getByRole('button', { name: 'Apply move' }))
    expect(moveModelBy).toHaveBeenCalledWith({ x: 10, y: 0, z: 0 })
    expect((screen.getByLabelText('Move x') as HTMLInputElement).value).toBe('')
  })

  it('converts rotate degrees to radians', async () => {
    const rotateModelBy = vi.fn()
    render(<TransformSection viewerRef={{ current: { rotateModelBy } as never }} />)
    await userEvent.type(screen.getByLabelText('Rotate y'), '90')
    await userEvent.click(screen.getByRole('button', { name: 'Apply rotate' }))
    expect(rotateModelBy).toHaveBeenCalledWith({ x: 0, y: Math.PI / 2, z: 0 })
  })

  it('leaves blank scale axes at factor 1', async () => {
    const scaleModelByAxes = vi.fn()
    render(<TransformSection viewerRef={{ current: { scaleModelByAxes } as never }} />)
    await userEvent.type(screen.getByLabelText('Scale (free) y'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Apply scale' }))
    expect(scaleModelByAxes).toHaveBeenCalledWith({ x: 1, y: 2, z: 1 })
  })

  it('blocks Apply scale and explains when one axis is out of bounds', async () => {
    const scaleModelByAxes = vi.fn()
    render(<TransformSection viewerRef={{ current: { scaleModelByAxes } as never }} />)
    await userEvent.type(screen.getByLabelText('Scale (free) y'), '2')
    await userEvent.type(screen.getByLabelText('Scale (free) z'), '1e12')
    expect((screen.getByRole('button', { name: 'Apply scale' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Enter a scale factor within range.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Apply scale' }))
    expect(scaleModelByAxes).not.toHaveBeenCalled()
  })

  it('blocks Apply scale when every axis is a non-positive factor', async () => {
    const scaleModelByAxes = vi.fn()
    render(<TransformSection viewerRef={{ current: { scaleModelByAxes } as never }} />)
    await userEvent.type(screen.getByLabelText('Scale (free) x'), '-1')
    await userEvent.type(screen.getByLabelText('Scale (free) y'), '0')
    await userEvent.type(screen.getByLabelText('Scale (free) z'), '-1')
    expect((screen.getByRole('button', { name: 'Apply scale' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Enter a scale factor within range.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Apply scale' }))
    expect(scaleModelByAxes).not.toHaveBeenCalled()
  })

  it('mirror, drop to floor, and center on plate call their handle methods with no args', async () => {
    const mirrorModel = vi.fn()
    const dropToFloor = vi.fn()
    const centerOnPlate = vi.fn()
    render(<TransformSection viewerRef={{ current: { mirrorModel, dropToFloor, centerOnPlate } as never }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mirror Y' }))
    expect(mirrorModel).toHaveBeenCalledWith('y')
    await userEvent.click(screen.getByRole('button', { name: 'Drop to floor' }))
    expect(dropToFloor).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Center on plate' }))
    expect(centerOnPlate).toHaveBeenCalled()
  })
})

describe('TransformSection - auto-orient', () => {
  it('calls autoOrient and shows the before/after note', async () => {
    const autoOrient = vi.fn(() => ({ status: 'applied', beforePct: 60, afterPct: 5 }))
    render(<TransformSection viewerRef={{ current: { autoOrient } as never }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Auto-orient' }))
    expect(autoOrient).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Overhang area 60% to 5%')).toBeTruthy()
  })

  it('shows the too-large note when the search was skipped', async () => {
    const autoOrient = vi.fn(() => ({ status: 'skipped' }))
    render(<TransformSection viewerRef={{ current: { autoOrient } as never }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Auto-orient' }))
    expect(screen.getByText('Model too large to auto-orient')).toBeTruthy()
  })

  it('shows the already-oriented note on a no-op', async () => {
    const autoOrient = vi.fn(() => ({ status: 'noop' }))
    render(<TransformSection viewerRef={{ current: { autoOrient } as never }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Auto-orient' }))
    expect(screen.getByText('Already well oriented')).toBeTruthy()
  })

  it('disables the button while locked', () => {
    useViewerStore.setState({ splitParts: [{ id: 'a', name: 'a', triangleCount: 1, visible: true }] })
    render(<TransformSection viewerRef={{ current: null }} />)
    expect((screen.getByRole('button', { name: 'Auto-orient' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
