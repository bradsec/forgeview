import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useViewerStore } from '../../store/viewerStore'
import { SolidToolsSection } from './SolidToolsSection'

afterEach(cleanup)

describe('SolidToolsSection spacing', () => {
  it('shows spacing and warns when wall thickness is below one cell', () => {
    useViewerStore.setState({ geometryDetails: {
      width: 80, height: 40, depth: 20, vertices: 8, meshes: 1,
      boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
      watertight: true, modelUnitInMm: 1, overhangFaceCount: 0, thinWallFaceCount: 0,
    } })
    render(<SolidToolsSection viewerRef={{ current: null }} />)
    expect(screen.getByText(/Sampling spacing: 2.5 mm/)).toBeTruthy()
    expect(screen.getByText(/Wall thickness is below the sampling spacing/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Hollow resolution'), { target: { value: '64' } })
    expect(screen.getByText(/Sampling spacing: 1.25 mm/)).toBeTruthy()
    expect(screen.queryByText(/Wall thickness is below the sampling spacing/)).toBeNull()
    act(() => useViewerStore.setState({ geometryDetails: null }))
    expect(screen.queryByText(/Sampling spacing:/)).toBeNull()
  })
})
