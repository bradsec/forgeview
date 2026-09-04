import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MeasureSection } from './MeasureSection'
import { useViewerStore } from '../../store/viewerStore'

const withModel = () =>
  useViewerStore.setState({
    geometryDetails: {
      width: 1, height: 1, depth: 1, vertices: 1, meshes: 1,
      boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
      watertight: true, modelUnitInMm: 1,
    },
  })

describe('MeasureSection', () => {
  beforeEach(() =>
    useViewerStore.setState({ geometryDetails: null, measureMode: false, measureDistanceMm: null, measurementUnit: 'mm' }),
  )

  it('disables the toggle without a model', () => {
    render(<MeasureSection viewerRef={{ current: null }} />)
    expect((screen.getByRole('button', { name: 'Measure distance' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('toggles measure mode', async () => {
    withModel()
    render(<MeasureSection viewerRef={{ current: null }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Measure distance' }))
    expect(useViewerStore.getState().measureMode).toBe(true)
  })

  it('shows the measured distance in the display unit', () => {
    withModel()
    useViewerStore.setState({ measureMode: true, measureDistanceMm: 25.4, measurementUnit: 'in' })
    render(<MeasureSection viewerRef={{ current: null }} />)
    expect(screen.getByTestId('measure-distance').textContent).toContain('1 in')
  })

  it('Clear calls the handle', async () => {
    withModel()
    useViewerStore.setState({ measureMode: true })
    const resetMeasure = vi.fn()
    render(<MeasureSection viewerRef={{ current: { resetMeasure } as never }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(resetMeasure).toHaveBeenCalled()
  })
})
