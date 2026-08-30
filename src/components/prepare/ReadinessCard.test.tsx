import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReadinessCard } from './ReadinessCard'
import type { PrepCheck } from '../../services/prepChecks'

const checks: PrepCheck[] = [
  { id: 'watertight', label: 'Watertight', state: 'fail', detail: 'Not watertight', fixId: 'seal' },
  { id: 'thickness', label: 'Thin walls', state: 'unavailable', detail: 'Available in a later update' },
]

describe('ReadinessCard', () => {
  it('renders a row per check with its state and detail', () => {
    render(<ReadinessCard checks={checks} onFix={vi.fn()} />)
    expect(screen.getByTestId('check-watertight').getAttribute('data-state')).toBe('fail')
    expect(screen.getByText('Not watertight')).toBeTruthy()
    expect(screen.getByTestId('check-thickness').getAttribute('data-state')).toBe('unavailable')
  })

  it('shows a Fix button only when the check has a fixId and calls onFix with it', async () => {
    const onFix = vi.fn()
    render(<ReadinessCard checks={checks} onFix={onFix} />)
    const rows = screen.getByTestId('check-watertight')
    await userEvent.click(within(rows).getByRole('button', { name: 'Fix Watertight' }))
    expect(onFix).toHaveBeenCalledWith('seal')
    expect(within(screen.getByTestId('check-thickness')).queryByRole('button', { name: 'Fix' })).toBeNull()
  })

  it('hides Fix when canFix returns false', () => {
    render(<ReadinessCard checks={[{ id: 'watertight', label: 'Watertight', state: 'fail', detail: 'x', fixId: 'seal' }]} onFix={vi.fn()} canFix={() => false} />)
    expect(screen.queryByRole('button', { name: /fix/i })).toBeNull()
  })

  it('warn rows use the --warning token class', () => {
    render(<ReadinessCard checks={[{ id: 'watertight', label: 'Watertight', state: 'warn', detail: 'x' }]} onFix={vi.fn()} />)
    expect(screen.getByTestId('check-watertight').querySelector('.text-\\[var\\(--warning\\)\\]')).toBeTruthy()
  })
})
