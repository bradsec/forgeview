import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemeshSection } from './RemeshSection'

afterEach(cleanup)

describe('RemeshSection', () => {
  it('submits triangle target and reports actual output', async () => {
    const onRemesh = vi.fn().mockResolvedValue({ beforeTriangles: 2000, afterTriangles: 998 })
    render(<RemeshSection onRemesh={onRemesh} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply remesh' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('998 triangles'))
    expect(onRemesh).toHaveBeenCalledWith({ operation: 'decimate', targetTriangles: 1000 }, expect.any(AbortSignal))
  })
  it('submits uniform grid resolution and supports cancellation', async () => {
    const onRemesh = vi.fn((_options, signal?: AbortSignal) => new Promise<{ beforeTriangles: number; afterTriangles: number }>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')))))
    render(<RemeshSection onRemesh={onRemesh} />)
    fireEvent.change(screen.getByLabelText('Operation'), { target: { value: 'remesh' } })
    fireEvent.change(screen.getByLabelText('Grid resolution'), { target: { value: '16' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply remesh' }))
    expect(onRemesh).toHaveBeenCalledWith({ operation: 'remesh', resolution: 16 }, expect.any(AbortSignal))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel remesh' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Cancelled'))
  })
})
