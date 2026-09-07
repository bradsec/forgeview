import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnalysisSection } from './AnalysisSection'
import { useViewerStore } from '../../store/viewerStore'

const details = {
  width: 10, height: 10, depth: 10, vertices: 1, meshes: 1,
  boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
  watertight: true, modelUnitInMm: 1, overhangFaceCount: 0, thinWallFaceCount: 0,
}

describe('AnalysisSection', () => {
  beforeEach(() =>
    useViewerStore.setState({
      geometryDetails: null, overhangMode: false, overhangThresholdDeg: 45, overhangOverlayStatus: null,
    }),
  )

  it('disables the toggle and threshold input without a model', () => {
    render(<AnalysisSection viewerRef={{ current: null }} />)
    expect((screen.getByRole('button', { name: 'Show overhang heatmap' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Overhang angle') as HTMLInputElement).disabled).toBe(true)
  })

  it('toggles overhang mode', async () => {
    useViewerStore.setState({ geometryDetails: details })
    render(<AnalysisSection viewerRef={{ current: null }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Show overhang heatmap' }))
    expect(useViewerStore.getState().overhangMode).toBe(true)
  })

  it('updates the threshold on a valid value', async () => {
    useViewerStore.setState({ geometryDetails: details })
    render(<AnalysisSection viewerRef={{ current: null }} />)
    const input = screen.getByLabelText('Overhang angle')
    await userEvent.clear(input)
    await userEvent.type(input, '30')
    expect(useViewerStore.getState().overhangThresholdDeg).toBe(30)
  })

  it('ignores an invalid (non-positive) threshold value', async () => {
    useViewerStore.setState({ geometryDetails: details })
    render(<AnalysisSection viewerRef={{ current: null }} />)
    const input = screen.getByLabelText('Overhang angle')
    await userEvent.clear(input)
    await userEvent.type(input, '-5')
    expect(useViewerStore.getState().overhangThresholdDeg).toBe(45)
  })

  it('shows the not-eligible note when meshes were skipped', () => {
    useViewerStore.setState({
      geometryDetails: details,
      overhangMode: true,
      overhangOverlayStatus: { meshCount: 1, skippedMeshes: 2 },
    })
    render(<AnalysisSection viewerRef={{ current: null }} />)
    expect(screen.getByText('2 meshes not eligible')).toBeTruthy()
  })
})

describe('AnalysisSection - wall thickness', () => {
  const details = {
    width: 10, height: 10, depth: 10, vertices: 1, meshes: 1,
    boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
    watertight: true, modelUnitInMm: 1, overhangFaceCount: 0, thinWallFaceCount: 0,
  }

  beforeEach(() =>
    useViewerStore.setState({
      geometryDetails: details, wallThicknessMode: false, minWallThicknessMm: 1.0,
      wallThicknessOverlayStatus: null,
    }),
  )

  it('toggles wall thickness mode', async () => {
    render(<AnalysisSection viewerRef={{ current: null }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Show wall thickness heatmap' }))
    expect(useViewerStore.getState().wallThicknessMode).toBe(true)
  })

  it('commits a valid min-wall value and rejects <= 0', async () => {
    render(<AnalysisSection viewerRef={{ current: null }} />)
    const input = screen.getByLabelText('Min wall')
    await userEvent.clear(input)
    await userEvent.type(input, '0.6')
    expect(useViewerStore.getState().minWallThicknessMm).toBe(0.6)
    await userEvent.clear(input)
    await userEvent.type(input, '-1')
    expect(useViewerStore.getState().minWallThicknessMm).toBe(0.6)
  })

  it('disables the toggle and shows a note when the model is too large', () => {
    useViewerStore.setState({ geometryDetails: { ...details, thinWallFaceCount: null } })
    render(<AnalysisSection viewerRef={{ current: null }} />)
    expect((screen.getByRole('button', { name: 'Show wall thickness heatmap' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Model too large for wall-thickness analysis')).toBeTruthy()
  })

  it('shows the unsampled-faces note', () => {
    useViewerStore.setState({
      wallThicknessMode: true,
      wallThicknessOverlayStatus: { meshCount: 1, skippedMeshes: 0, unsampledFaces: 7 },
    })
    render(<AnalysisSection viewerRef={{ current: null }} />)
    expect(screen.getByText('7 faces could not be sampled (open surface)')).toBeTruthy()
  })

  it('shows the not-eligible note when meshes were skipped', () => {
    useViewerStore.setState({
      overhangMode: false,
      wallThicknessMode: true,
      wallThicknessOverlayStatus: { meshCount: 1, skippedMeshes: 2, unsampledFaces: 0 },
    })
    render(<AnalysisSection viewerRef={{ current: null }} />)
    expect(screen.getByText('2 meshes not eligible')).toBeTruthy()
  })
})

describe('AnalysisSection - inspect (x-ray and clip)', () => {
  const details = {
    width: 10, height: 10, depth: 10, vertices: 1, meshes: 1,
    boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
    watertight: true, modelUnitInMm: 1, overhangFaceCount: 0, thinWallFaceCount: 0,
  }

  beforeEach(() =>
    useViewerStore.setState({
      geometryDetails: details,
      overhangMode: false, wallThicknessMode: false,
      xrayMode: false, clipMode: false, clipAxis: 'y', clipOffset: 0.5, clipFlip: false,
    }),
  )

  it('toggles x-ray', async () => {
    render(<AnalysisSection viewerRef={{ current: null }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Show X-ray' }))
    expect(useViewerStore.getState().xrayMode).toBe(true)
  })

  it('shows the clip controls only while clip is armed', async () => {
    render(<AnalysisSection viewerRef={{ current: null }} />)
    expect(screen.queryByLabelText('Clip position')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Show clip plane' }))
    expect(useViewerStore.getState().clipMode).toBe(true)
    expect(screen.getByLabelText('Clip position')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'X' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Z' })).toBeTruthy()
  })

  it('commits axis, position, and flip changes', async () => {
    useViewerStore.setState({ clipMode: true })
    render(<AnalysisSection viewerRef={{ current: null }} />)
    await userEvent.click(screen.getByRole('button', { name: 'X' }))
    expect(useViewerStore.getState().clipAxis).toBe('x')
    fireEvent.change(screen.getByLabelText('Clip position'), { target: { value: '0.25' } })
    expect(useViewerStore.getState().clipOffset).toBeCloseTo(0.25)
    await userEvent.click(screen.getByRole('button', { name: 'Flip side' }))
    expect(useViewerStore.getState().clipFlip).toBe(true)
  })

  it('disables both toggles without a model', () => {
    useViewerStore.setState({ geometryDetails: null })
    render(<AnalysisSection viewerRef={{ current: null }} />)
    expect((screen.getByRole('button', { name: 'Show X-ray' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Show clip plane' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('AnalysisSection - plane cut', () => {
  const details = {
    width: 10, height: 10, depth: 10, vertices: 1, meshes: 1,
    boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
    watertight: true, modelUnitInMm: 1, overhangFaceCount: 0, thinWallFaceCount: 0,
  }
  beforeEach(() =>
    useViewerStore.setState({
      geometryDetails: details, clipMode: true, loadedModels: [], splitParts: [],
    }),
  )

  it('calls cutAtPlane and shows nothing extra on success', async () => {
    const cutAtPlane = vi.fn().mockResolvedValue({ status: 'cut' })
    render(<AnalysisSection viewerRef={{ current: { cutAtPlane } as never }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cut at plane' }))
    expect(cutAtPlane).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('The cut plane does not pass through the model')).toBeNull()
    expect((screen.getByRole('button', { name: 'Cut at plane' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the reason when the cut is ineligible', async () => {
    const cutAtPlane = vi.fn().mockResolvedValue({ status: 'ineligible', reason: 'Undo the current split first' })
    render(<AnalysisSection viewerRef={{ current: { cutAtPlane } as never }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cut at plane' }))
    expect(await screen.findByText('Undo the current split first')).toBeTruthy()
  })

  it('shows a message when the plane misses the model', async () => {
    const cutAtPlane = vi.fn().mockResolvedValue({ status: 'empty' })
    render(<AnalysisSection viewerRef={{ current: { cutAtPlane } as never }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cut at plane' }))
    expect(await screen.findByText('The cut plane does not pass through the model')).toBeTruthy()
  })

  it('disables the button while multi-model or already split', () => {
    useViewerStore.setState({ loadedModels: [{ id: 'a', path: 'a', name: 'a', extension: '.stl', sizeBytes: 1, triangleCount: 1 }] })
    render(<AnalysisSection viewerRef={{ current: null }} />)
    expect((screen.getByRole('button', { name: 'Cut at plane' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
