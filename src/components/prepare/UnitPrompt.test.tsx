import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UnitPrompt } from './UnitPrompt'
import { useViewerStore } from '../../store/viewerStore'

const details = (over: Partial<ReturnType<typeof useViewerStore.getState>['geometryDetails'] & object> = {}) => ({
  width: 10, height: 10, depth: 10, vertices: 1, meshes: 1,
  boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
  watertight: false, modelUnitInMm: null, overhangFaceCount: 0, thinWallFaceCount: 0, ...over,
})

describe('UnitPrompt', () => {
  beforeEach(() => useViewerStore.setState({ geometryDetails: null }))

  it('renders nothing without a model', () => {
    render(<UnitPrompt viewerRef={{ current: null }} />)
    expect(screen.queryByTestId('unit-prompt')).toBeNull()
  })

  it('renders nothing once a unit is known', () => {
    useViewerStore.setState({ geometryDetails: details({ modelUnitInMm: 1 }) })
    render(<UnitPrompt viewerRef={{ current: null }} />)
    expect(screen.queryByTestId('unit-prompt')).toBeNull()
  })

  it('applies the selected unit in mm', async () => {
    useViewerStore.setState({ geometryDetails: details() })
    const setModelUnit = vi.fn()
    render(<UnitPrompt viewerRef={{ current: { setModelUnit } as never }} />)
    await userEvent.selectOptions(screen.getByLabelText('Import unit'), 'in')
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(setModelUnit).toHaveBeenCalledWith(25.4)
  })
})
