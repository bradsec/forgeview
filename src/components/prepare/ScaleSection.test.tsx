import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScaleSection } from './ScaleSection'
import { useViewerStore, DEFAULT_BUILD_VOLUME_MM } from '../../store/viewerStore'

const details = {
  width: 50, height: 20, depth: 10, vertices: 1, meshes: 1,
  boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
  watertight: true, modelUnitInMm: 1, overhangFaceCount: 0, thinWallFaceCount: 0,
}

describe('ScaleSection', () => {
  beforeEach(() =>
    useViewerStore.setState({
      geometryDetails: details, measurementUnit: 'mm', splitParts: [], measureMode: false,
      buildVolumeMm: { ...DEFAULT_BUILD_VOLUME_MM },
    }),
  )

  it('locks while split by shell', () => {
    useViewerStore.setState({ splitParts: [{ id: 'a', name: 'a', triangleCount: 1, visible: true }] })
    render(<ScaleSection viewerRef={{ current: null }} />)
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('scales the longest edge to a target', async () => {
    const scaleModelBy = vi.fn()
    render(<ScaleSection viewerRef={{ current: { scaleModelBy } as never }} />)
    // default axis "longest" = 50; target 100 -> factor 2
    await userEvent.type(screen.getByLabelText('Target length (mm)'), '100')
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(scaleModelBy).toHaveBeenCalledWith(2, 'Scale to target')
  })

  it('rejects an out-of-range target', async () => {
    render(<ScaleSection viewerRef={{ current: null }} />)
    await userEvent.type(screen.getByLabelText('Target length (mm)'), '0')
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('fits to the build volume', async () => {
    const scaleModelBy = vi.fn()
    render(<ScaleSection viewerRef={{ current: { scaleModelBy } as never }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Fit to build volume' }))
    // min(220/50, 220/20, 250/10) = 4.4, shaved slightly to stay strictly inside the plate
    expect(scaleModelBy).toHaveBeenCalledWith(expect.closeTo(4.4, 5), 'Scale to fit build volume')
  })

  it('resets the build volume', async () => {
    useViewerStore.setState({ buildVolumeMm: { x: 1, y: 1, z: 1 } })
    render(<ScaleSection viewerRef={{ current: null }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(useViewerStore.getState().buildVolumeMm).toEqual({ x: 220, y: 220, z: 250 })
  })
})

describe('ScaleSection - build volume box toggle', () => {
  beforeEach(() =>
    useViewerStore.setState({
      geometryDetails: details, measurementUnit: 'mm', splitParts: [], measureMode: false,
      buildVolumeMm: { ...DEFAULT_BUILD_VOLUME_MM }, showBuildVolume: false,
    }),
  )

  it('toggles showBuildVolume from the button', async () => {
    render(<ScaleSection viewerRef={{ current: null }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Show build volume' }))
    expect(useViewerStore.getState().showBuildVolume).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Hide build volume' }))
    expect(useViewerStore.getState().showBuildVolume).toBe(false)
  })

  it('reflects the current store state as aria-pressed', () => {
    useViewerStore.setState({ showBuildVolume: true })
    render(<ScaleSection viewerRef={{ current: null }} />)
    const btn = screen.getByRole('button', { name: 'Hide build volume' })
    expect(btn.getAttribute('aria-pressed')).toBe('true')
  })

  it('shows the toggle with no model open', () => {
    useViewerStore.setState({ geometryDetails: null })
    render(<ScaleSection viewerRef={{ current: null }} />)
    expect(screen.getByRole('button', { name: 'Show build volume' })).toBeTruthy()
  })
})
