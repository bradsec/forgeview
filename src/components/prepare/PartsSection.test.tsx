import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PartsSection } from './PartsSection'
import { useViewerStore } from '../../store/viewerStore'
import type { Viewer3DHandle } from '../Viewer3D'

function stubRef(over: Partial<Viewer3DHandle> = {}) {
  return { current: { splitByShell: vi.fn(() => ({ parts: 2, droppedFragments: 0 })), ...over } } as unknown as React.RefObject<Viewer3DHandle | null>
}

beforeEach(() => {
  useViewerStore.setState({
    filePath: '/tmp/x.stl', loadedModels: [], pendingModelLoads: 0,
    splitParts: [], exportTargetId: null, exportOpen: false, error: null, notice: null,
  })
})

describe('PartsSection', () => {
  const splitBtn = () => screen.getByRole('button', { name: 'Split by shell' }) as HTMLButtonElement

  it('enables the Split button with a single preview model', () => {
    render(<PartsSection viewerRef={stubRef()} />)
    expect(splitBtn().disabled).toBe(false)
  })

  it('disables Split with no model, in multi-model mode, and while already split', () => {
    useViewerStore.setState({ filePath: null })
    const { rerender } = render(<PartsSection viewerRef={stubRef()} />)
    expect(splitBtn().disabled).toBe(true)

    useViewerStore.setState({ filePath: '/tmp/x.stl', loadedModels: [{ id: 'm', path: '/a', name: 'a', extension: 'stl', sizeBytes: 1, triangleCount: 1 }] })
    rerender(<PartsSection viewerRef={stubRef()} />)
    expect(splitBtn().disabled).toBe(true)

    useViewerStore.setState({ loadedModels: [], splitParts: [{ id: 'a', name: 'A', triangleCount: 5, visible: true }] })
    rerender(<PartsSection viewerRef={stubRef()} />)
    expect(splitBtn().disabled).toBe(true)
  })

  it('calls splitByShell and routes a thrown message to setError', async () => {
    const ref = stubRef({ splitByShell: vi.fn(() => { throw new Error('Nothing to split: the model is a single connected shell') }) })
    render(<PartsSection viewerRef={ref} />)
    await userEvent.click(screen.getByRole('button', { name: 'Split by shell' }))
    expect(ref.current!.splitByShell).toHaveBeenCalled()
    expect(useViewerStore.getState().error).toMatch(/nothing to split/i)
  })

  it('renders a row per part and toggles visibility', async () => {
    useViewerStore.setState({ splitParts: [
      { id: 'a', name: 'x — part 1', triangleCount: 12340, visible: true },
      { id: 'b', name: 'x — part 2', triangleCount: 8102, visible: true },
    ] })
    render(<PartsSection viewerRef={stubRef()} />)
    expect(screen.getByText(/12,340/)).toBeTruthy()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show x — part 2' }))
    expect(useViewerStore.getState().splitParts.find((p) => p.id === 'b')!.visible).toBe(false)
  })

  it('Export sets exportTargetId and opens the dialog', async () => {
    useViewerStore.setState({ splitParts: [{ id: 'a', name: 'x — part 1', triangleCount: 1, visible: true }] })
    render(<PartsSection viewerRef={stubRef()} />)
    await userEvent.click(screen.getByRole('button', { name: /export/i }))
    expect(useViewerStore.getState().exportTargetId).toBe('a')
    expect(useViewerStore.getState().exportOpen).toBe(true)
  })
})
