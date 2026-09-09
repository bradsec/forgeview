import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RepairDialog } from './RepairDialog'
import { useViewerStore } from '../store/viewerStore'

function stubRef() {
  return { current: { runRepair: vi.fn().mockResolvedValue({ label: 'x', perMesh: [], seal: undefined, skippedMeshes: 0 }) } }
}

beforeEach(() => {
  useViewerStore.setState({ repairDialogOpen: true, filePath: '/m/x.stl', loadedModels: [] })
})

describe('RepairDialog', () => {
  it('lists the seven stage rows in pipeline order', () => {
    render(<RepairDialog viewerRef={stubRef() as never} />)
    const rows = screen.getAllByTestId(/^repair-stage-/)
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'repair-stage-weld', 'repair-stage-degenerate', 'repair-stage-duplicate',
      'repair-stage-normals', 'repair-stage-smallShells', 'repair-stage-holeFill',
      'repair-stage-seal',
    ])
  })

  it('Run on a stage row calls runRepair with just that id', async () => {
    const ref = stubRef()
    render(<RepairDialog viewerRef={ref as never} />)
    await userEvent.click(within(screen.getByTestId('repair-stage-holeFill')).getByRole('button', { name: /run/i }))
    expect(ref.current.runRepair).toHaveBeenCalledWith(
      ['holeFill'], expect.objectContaining({ resolution: expect.any(Number) }), expect.any(Function), expect.any(Object),
    )
  })

  it('Repair all sends the full ordered pipeline including seal', async () => {
    const ref = stubRef()
    render(<RepairDialog viewerRef={ref as never} />)
    await userEvent.click(screen.getByRole('button', { name: /repair all/i }))
    expect(ref.current.runRepair.mock.calls[0][0]).toEqual(
      ['weld','degenerate','duplicate','normals','smallShells','holeFill','seal'],
    )
  })

  it('the seal row exposes the resolution select and strip-walls checkbox', () => {
    render(<RepairDialog viewerRef={stubRef() as never} />)
    const seal = screen.getByTestId('repair-stage-seal')
    expect(within(seal).getByRole('combobox')).toBeTruthy()
    expect(within(seal).getByRole('checkbox')).toBeTruthy()
  })

  it('aborts the in-flight run when the dialog is closed', async () => {
    let capturedSignal: AbortSignal | undefined
    const runRepair = vi.fn((_ids, _opts, _onProgress, signal?: AbortSignal) => {
      capturedSignal = signal
      return new Promise(() => {}) // never resolves — stays in flight
    })
    render(<RepairDialog viewerRef={{ current: { runRepair } } as never} />)

    await userEvent.click(screen.getByRole('button', { name: /repair all/i }))
    expect(capturedSignal).toBeInstanceOf(AbortSignal)
    expect(capturedSignal!.aborted).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(capturedSignal!.aborted).toBe(true)
  })
})


it('does not create more WebGL contexts for repair progress updates', async () => {
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  let onProgress: ((percent: number, phase: string) => void) | undefined
  const runRepair = vi.fn((_ids, _opts, callback) => {
    onProgress = callback
    return new Promise(() => {})
  })
  try {
    render(<RepairDialog viewerRef={{ current: { runRepair } } as never} />)
    const probes = context.mock.calls.length
    expect(probes).toBe(1)
    await userEvent.click(screen.getByRole('button', { name: /repair all/i }))
    act(() => onProgress!(30, 'Voxelizing'))
    act(() => onProgress!(70, 'Building surface'))
    expect(context).toHaveBeenCalledTimes(probes)
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
  } finally {
    context.mockRestore()
  }
})
