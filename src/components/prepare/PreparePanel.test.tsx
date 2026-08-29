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
  useViewerStore.setState({ geometryDetails: null, canUndoEdit: false, solidEditorOpen: false })
})

describe('PreparePanel', () => {
  it('shows the empty state when no model is loaded', () => {
    render(<PreparePanel />)
    expect(screen.getByTestId('prepare-empty')).toBeTruthy()
    expect(screen.queryByTestId('check-watertight')).toBeNull()
  })

  it('renders the readiness card and repair section when a model is loaded', () => {
    useViewerStore.setState({ geometryDetails: details })
    render(<PreparePanel />)
    expect(screen.getByTestId('check-watertight').getAttribute('data-state')).toBe('fail')
    expect(screen.getByRole('button', { name: 'Make solid…' })).toBeTruthy()
  })

  it('a Fix on a seal row opens the Make solid dialog', async () => {
    useViewerStore.setState({ geometryDetails: details })
    render(<PreparePanel />)
    await userEvent.click(within(screen.getByTestId('check-watertight')).getByRole('button', { name: 'Fix' }))
    expect(useViewerStore.getState().solidEditorOpen).toBe(true)
  })

  it('the Make solid button opens the dialog', async () => {
    useViewerStore.setState({ geometryDetails: details })
    render(<PreparePanel />)
    await userEvent.click(screen.getByRole('button', { name: 'Make solid…' }))
    expect(useViewerStore.getState().solidEditorOpen).toBe(true)
  })

  it('Undo is disabled until an edit can be undone, then calls onUndoEdit', async () => {
    useViewerStore.setState({ geometryDetails: details })
    const onUndoEdit = vi.fn()
    const { rerender } = render(<PreparePanel onUndoEdit={onUndoEdit} />)
    expect((screen.getByRole('button', { name: 'Undo last model edit' }) as HTMLButtonElement).disabled).toBe(true)
    useViewerStore.setState({ canUndoEdit: true })
    rerender(<PreparePanel onUndoEdit={onUndoEdit} />)
    await userEvent.click(screen.getByRole('button', { name: 'Undo last model edit' }))
    expect(onUndoEdit).toHaveBeenCalledOnce()
  })
})
