import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RepairSection } from './RepairSection'
import { useViewerStore } from '../../store/viewerStore'

beforeEach(() => {
  useViewerStore.setState({
    filePath: '/tmp/x.stl', loadedModels: [], canUndoEdit: false, undoLabels: [],
    holeFillMode: false, holeFillStatus: null, splitParts: [],
  })
})

describe('RepairSection — fill a single hole', () => {
  it('toggles holeFillMode and reflects it on aria-pressed', async () => {
    render(<RepairSection />)
    const btn = screen.getByRole('button', { name: 'Fill a single hole' }) as HTMLButtonElement
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    await userEvent.click(btn)
    expect(useViewerStore.getState().holeFillMode).toBe(true)
  })

  it('is disabled with no model', () => {
    useViewerStore.setState({ filePath: null, loadedModels: [] })
    render(<RepairSection />)
    expect((screen.getByRole('button', { name: 'Fill a single hole' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the loop count and eligibility note when armed', () => {
    useViewerStore.setState({ holeFillMode: true, holeFillStatus: { loops: 3, skippedMeshes: 1 } })
    render(<RepairSection />)
    expect(screen.getByText(/3 open loops · 1 mesh not eligible/)).toBeTruthy()
  })

  it('shows a singular count with no note when nothing is skipped', () => {
    useViewerStore.setState({ holeFillMode: true, holeFillStatus: { loops: 1, skippedMeshes: 0 } })
    render(<RepairSection />)
    expect(screen.getByText(/1 open loop\b/)).toBeTruthy()
    expect(screen.queryByText(/not eligible/)).toBeNull()
  })
})

describe('RepairSection — split state', () => {
  it('disables both Repair and Fill buttons and shows recombine hint when split', () => {
    useViewerStore.setState({
      filePath: '/tmp/x.stl',
      splitParts: [{ id: 'a', name: 'A', triangleCount: 5, visible: true }],
    })
    render(<RepairSection />)
    const repairBtn = screen.getByRole('button', { name: 'Repair…' }) as HTMLButtonElement
    const fillBtn = screen.getByRole('button', { name: 'Fill a single hole' }) as HTMLButtonElement
    expect(repairBtn.disabled).toBe(true)
    expect(fillBtn.disabled).toBe(true)
    expect(screen.getByText(/Recombine the split parts/)).toBeTruthy()
  })

  it('enables both Repair and Fill buttons when not split with a model', () => {
    useViewerStore.setState({
      filePath: '/tmp/x.stl',
      splitParts: [],
    })
    render(<RepairSection />)
    const repairBtn = screen.getByRole('button', { name: 'Repair…' }) as HTMLButtonElement
    const fillBtn = screen.getByRole('button', { name: 'Fill a single hole' }) as HTMLButtonElement
    expect(repairBtn.disabled).toBe(false)
    expect(fillBtn.disabled).toBe(false)
    expect(screen.queryByText(/Recombine the split parts/)).toBeNull()
  })
})
