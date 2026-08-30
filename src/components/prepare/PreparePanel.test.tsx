import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreparePanel } from './PreparePanel'
import { useViewerStore } from '../../store/viewerStore'

const details = {
  width: 1, height: 1, depth: 1, vertices: 3, meshes: 1,
  boundaryEdges: 6, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
  watertight: false, modelUnitInMm: null,
}

beforeEach(() => {
  useViewerStore.setState({
    geometryDetails: null, canUndoEdit: false, solidEditorOpen: false,
    filePath: null, loadedModels: [],
  })
})

describe('PreparePanel', () => {
  it('shows the empty state when no model is loaded', () => {
    render(<PreparePanel />)
    expect(screen.getByTestId('prepare-empty')).toBeTruthy()
    expect(screen.queryByTestId('check-watertight')).toBeNull()
    expect(screen.getByRole('button', { name: 'Undo last model edit' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Make solid…' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders the readiness card and repair section when a model is loaded', () => {
    useViewerStore.setState({ geometryDetails: details, filePath: '/m/model.stl' })
    render(<PreparePanel />)
    expect(screen.getByTestId('check-watertight').getAttribute('data-state')).toBe('fail')
    expect(screen.getByRole('button', { name: 'Make solid…' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Make solid…' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a Fix on a seal row opens the Make solid dialog', async () => {
    useViewerStore.setState({ geometryDetails: details, filePath: '/m/model.stl' })
    render(<PreparePanel />)
    await userEvent.click(within(screen.getByTestId('check-watertight')).getByRole('button', { name: 'Fix Watertight' }))
    expect(useViewerStore.getState().solidEditorOpen).toBe(true)
  })

  it('the Make solid button opens the dialog', async () => {
    useViewerStore.setState({ geometryDetails: details, filePath: '/m/model.stl' })
    render(<PreparePanel />)
    await userEvent.click(screen.getByRole('button', { name: 'Make solid…' }))
    expect(useViewerStore.getState().solidEditorOpen).toBe(true)
  })

  it('Undo is disabled until an edit can be undone, then calls onUndoEdit', async () => {
    useViewerStore.setState({ geometryDetails: details, filePath: '/m/model.stl' })
    const onUndoEdit = vi.fn()
    const { rerender } = render(<PreparePanel onUndoEdit={onUndoEdit} />)
    expect((screen.getByRole('button', { name: 'Undo last model edit' }) as HTMLButtonElement).disabled).toBe(true)
    useViewerStore.setState({ canUndoEdit: true })
    rerender(<PreparePanel onUndoEdit={onUndoEdit} />)
    await userEvent.click(screen.getByRole('button', { name: 'Undo last model edit' }))
    expect(onUndoEdit).toHaveBeenCalledOnce()
    expect(onUndoEdit).toHaveBeenCalledWith(1)
  })
})

describe('PreparePanel undo history', () => {
  const details = {
    width: 1, height: 1, depth: 1, vertices: 3, meshes: 1,
    boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
    watertight: true, modelUnitInMm: null,
  }
  beforeEach(() => {
    useViewerStore.setState({
      geometryDetails: details, filePath: '/m/model.stl', loadedModels: [],
      canUndoEdit: false, undoLabels: [],
    })
  })

  it('shows no undo history list when there are no entries', () => {
    render(<PreparePanel />)
    expect(screen.queryByTestId('undo-history')).toBeNull()
    expect((screen.getByRole('button', { name: 'Undo last model edit' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders one row per undo label, newest first, and reverts to that depth on click', async () => {
    const onUndoEdit = vi.fn()
    useViewerStore.setState({ canUndoEdit: true, undoLabels: ['Weld vertices', 'Make solid'] })
    render(<PreparePanel onUndoEdit={onUndoEdit} />)
    const list = screen.getByTestId('undo-history')
    const rows = within(list).getAllByRole('button')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('Weld vertices')
    expect(rows[1].textContent).toContain('Make solid')
    await userEvent.click(rows[0])
    expect(onUndoEdit).toHaveBeenLastCalledWith(1)
    await userEvent.click(rows[1])
    expect(onUndoEdit).toHaveBeenLastCalledWith(2)
  })

  it('the Undo last model edit button undoes one step', async () => {
    const onUndoEdit = vi.fn()
    useViewerStore.setState({ canUndoEdit: true, undoLabels: ['Make solid'] })
    render(<PreparePanel onUndoEdit={onUndoEdit} />)
    await userEvent.click(screen.getByRole('button', { name: 'Undo last model edit' }))
    expect(onUndoEdit).toHaveBeenCalledWith(1)
  })
})
