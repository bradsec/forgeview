import { describe, it, expect, beforeEach } from 'vitest'
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
  it('keeps threshold fields in sync across responsive panels without losing decimal drafts', () => {
    useViewerStore.setState({ geometryDetails: details, minWallThicknessMm: 1 })
    render(<><AnalysisSection /><AnalysisSection /></>)
    const angles = screen.getAllByLabelText('Overhang angle') as HTMLInputElement[]
    const walls = screen.getAllByLabelText('Min wall') as HTMLInputElement[]
    fireEvent.change(angles[0], { target: { value: '30' } })
    expect(angles[1].value).toBe('30')
    fireEvent.change(walls[0], { target: { value: '2.' } })
    expect(walls[0].value).toBe('2.')
    expect(walls[1].value).toBe('2')
  })

  beforeEach(() =>
    useViewerStore.setState({
      geometryDetails: null, overhangMode: false, overhangThresholdDeg: 45, overhangOverlayStatus: null,
    }),
  )

  it('disables the toggle and threshold input without a model', () => {
    render(<AnalysisSection />)
    expect((screen.getByRole('button', { name: 'Show overhang heatmap' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Overhang angle') as HTMLInputElement).disabled).toBe(true)
  })

  it('toggles overhang mode', async () => {
    useViewerStore.setState({ geometryDetails: details })
    render(<AnalysisSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Show overhang heatmap' }))
    expect(useViewerStore.getState().overhangMode).toBe(true)
  })

  it('updates the threshold on a valid value', async () => {
    useViewerStore.setState({ geometryDetails: details })
    render(<AnalysisSection />)
    const input = screen.getByLabelText('Overhang angle')
    await userEvent.clear(input)
    await userEvent.type(input, '30')
    expect(useViewerStore.getState().overhangThresholdDeg).toBe(30)
  })

  it('ignores an invalid (non-positive) threshold value', async () => {
    useViewerStore.setState({ geometryDetails: details })
    render(<AnalysisSection />)
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
    render(<AnalysisSection />)
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
    render(<AnalysisSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Show wall thickness heatmap' }))
    expect(useViewerStore.getState().wallThicknessMode).toBe(true)
  })

  it('commits a valid min-wall value and rejects <= 0', async () => {
    render(<AnalysisSection />)
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
    render(<AnalysisSection />)
    expect((screen.getByRole('button', { name: 'Show wall thickness heatmap' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Model too large for wall-thickness analysis')).toBeTruthy()
  })

  it('shows the unsampled-faces note', () => {
    useViewerStore.setState({
      wallThicknessMode: true,
      wallThicknessOverlayStatus: { meshCount: 1, skippedMeshes: 0, unsampledFaces: 7 },
    })
    render(<AnalysisSection />)
    expect(screen.getByText('7 faces could not be sampled (open surface)')).toBeTruthy()
  })

  it('shows the not-eligible note when meshes were skipped', () => {
    useViewerStore.setState({
      overhangMode: false,
      wallThicknessMode: true,
      wallThicknessOverlayStatus: { meshCount: 1, skippedMeshes: 2, unsampledFaces: 0 },
    })
    render(<AnalysisSection />)
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
    render(<AnalysisSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Show X-ray' }))
    expect(useViewerStore.getState().xrayMode).toBe(true)
  })

  it('shows the clip controls only while clip is armed', async () => {
    render(<AnalysisSection />)
    expect(screen.queryByLabelText('Clip position')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Show clip plane' }))
    expect(useViewerStore.getState().clipMode).toBe(true)
    expect(screen.getByLabelText('Clip position')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'X' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Z' })).toBeTruthy()
  })

  it('commits axis, position, and flip changes', async () => {
    useViewerStore.setState({ clipMode: true })
    render(<AnalysisSection />)
    await userEvent.click(screen.getByRole('button', { name: 'X' }))
    expect(useViewerStore.getState().clipAxis).toBe('x')
    fireEvent.change(screen.getByLabelText('Clip position'), { target: { value: '0.25' } })
    expect(useViewerStore.getState().clipOffset).toBeCloseTo(0.25)
    await userEvent.click(screen.getByRole('button', { name: 'Flip side' }))
    expect(useViewerStore.getState().clipFlip).toBe(true)
  })

  it('disables both toggles without a model', () => {
    useViewerStore.setState({ geometryDetails: null })
    render(<AnalysisSection />)
    expect((screen.getByRole('button', { name: 'Show X-ray' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Show clip plane' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
