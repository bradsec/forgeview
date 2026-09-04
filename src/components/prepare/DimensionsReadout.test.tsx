import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DimensionsReadout } from './DimensionsReadout'
import { useViewerStore } from '../../store/viewerStore'

const details = {
  width: 100, height: 50, depth: 25, vertices: 1, meshes: 1,
  boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
  watertight: true, modelUnitInMm: 1,
}

describe('DimensionsReadout', () => {
  beforeEach(() => useViewerStore.setState({ geometryDetails: null, measurementUnit: 'mm' }))

  it('renders nothing without a model', () => {
    render(<DimensionsReadout />)
    expect(screen.queryByTestId('dimensions-readout')).toBeNull()
  })

  it('shows mm dimensions and the longest edge', () => {
    useViewerStore.setState({ geometryDetails: details })
    render(<DimensionsReadout />)
    // width value also lands on the Longest row (max axis)
    expect(screen.getAllByText('100 mm')).toHaveLength(2)
    expect(screen.getByText('50 mm')).toBeTruthy()
    expect(screen.getByText('25 mm')).toBeTruthy()
  })

  it('switches the display unit', async () => {
    useViewerStore.setState({ geometryDetails: details })
    render(<DimensionsReadout />)
    await userEvent.click(screen.getByRole('button', { name: 'in' }))
    expect(useViewerStore.getState().measurementUnit).toBe('in')
    // 100mm -> 3.94in on both the Width and Longest rows
    expect(screen.getAllByText('3.94 in')).toHaveLength(2)
  })

  it('marks the active unit with aria-pressed', () => {
    useViewerStore.setState({ geometryDetails: details, measurementUnit: 'cm' })
    render(<DimensionsReadout />)
    expect(screen.getByRole('button', { name: 'cm' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'mm' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('applies modelUnitInMm', () => {
    useViewerStore.setState({ geometryDetails: { ...details, modelUnitInMm: 10 } })
    render(<DimensionsReadout />)
    // 100 * 10 = 1000, on the Width and Longest rows
    expect(screen.getAllByText('1000 mm')).toHaveLength(2)
  })
})
