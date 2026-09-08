import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BatchPrep } from './BatchPrep'
import { prepareBatch } from '../services/batchPrep'
import { saveExportedFile } from '../services/saveFile'

vi.mock('../services/batchPrep', () => ({ BATCH_MAX_FILES: 100, prepareBatch: vi.fn() }))
vi.mock('../services/saveFile', () => ({ saveExportedFile: vi.fn(async () => 'chosen.zip') }))
const files = [{ name: 'part.stl', path: '/part.stl', extension: '.stl', size: 1, mtime: 0 }]

describe('BatchPrep', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires a unit choice and saves only through the explicit Export ZIP action', async () => {
    const bytes = new Uint8Array([1])
    vi.mocked(prepareBatch).mockResolvedValue({ bytes, entries: [{ source: '/part.stl', status: 'success', output: '001-part.stl' }] })
    render(<BatchPrep files={files} />)
    fireEvent.click(screen.getByRole('button', { name: 'Batch prepare (1)' }))
    expect((screen.getByRole('button', { name: 'Prepare files' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Unitless input units'), { target: { value: 'in' } })
    fireEvent.click(screen.getByRole('button', { name: 'Prepare files' }))
    await screen.findByRole('button', { name: 'Export ZIP' })
    expect(prepareBatch).toHaveBeenCalledWith(files, 'in', expect.any(AbortSignal), expect.any(Function))
    expect(saveExportedFile).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Export ZIP' }))
    expect(saveExportedFile).toHaveBeenCalledWith(bytes, 'forgeview-prepared.zip')
    await screen.findByText('Saved chosen.zip')
  })

  it('cancels the job without exposing an export action', async () => {
    vi.mocked(prepareBatch).mockImplementation((_files, _unit, signal, progress) => {
      progress({ completed: 0, total: 1, name: 'part.stl' })
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError'))))
    })
    render(<BatchPrep files={files} />)
    fireEvent.click(screen.getByRole('button', { name: 'Batch prepare (1)' }))
    fireEvent.change(screen.getByLabelText('Unitless input units'), { target: { value: 'mm' } })
    fireEvent.click(screen.getByRole('button', { name: 'Prepare files' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel batch' }))
    await screen.findByText('Batch cancelled. No output was saved.')
    expect(screen.queryByRole('button', { name: 'Export ZIP' })).toBeNull()
    expect(saveExportedFile).not.toHaveBeenCalled()
  })

  it('aborts processing when the folder panel unmounts', async () => {
    let signal!: AbortSignal
    vi.mocked(prepareBatch).mockImplementation((_files, _unit, activeSignal) => {
      signal = activeSignal
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError'))))
    })
    const view = render(<BatchPrep files={files} />)
    fireEvent.click(screen.getByRole('button', { name: 'Batch prepare (1)' }))
    fireEvent.change(screen.getByLabelText('Unitless input units'), { target: { value: 'mm' } })
    fireEvent.click(screen.getByRole('button', { name: 'Prepare files' }))
    view.unmount()
    await waitFor(() => expect(signal.aborted).toBe(true))
  })
})
