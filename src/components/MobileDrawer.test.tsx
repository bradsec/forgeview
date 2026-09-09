import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MobileDrawer } from './MobileDrawer'

describe('MobileDrawer', () => {
  it('renders its children', () => {
    render(<MobileDrawer side="left" open onClose={() => {}}><p>panel body</p></MobileDrawer>)
    expect(screen.getByText('panel body')).toBeTruthy()
  })

  it('shows a scrim only when open', () => {
    const { rerender } = render(
      <MobileDrawer side="left" open={false} onClose={() => {}}><p>x</p></MobileDrawer>
    )
    expect(screen.queryByTestId('drawer-scrim')).toBeNull()
    rerender(<MobileDrawer side="left" open onClose={() => {}}><p>x</p></MobileDrawer>)
    expect(screen.getByTestId('drawer-scrim')).toBeTruthy()
  })

  it('clicking the scrim calls onClose', async () => {
    const onClose = vi.fn()
    render(<MobileDrawer side="left" open onClose={onClose}><p>x</p></MobileDrawer>)
    await userEvent.click(screen.getByTestId('drawer-scrim'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('applies the off-screen translate class when closed', () => {
    render(<MobileDrawer side="right" open={false} onClose={() => {}}><p>x</p></MobileDrawer>)
    expect(screen.getByTestId('drawer-panel').className).toContain('translate-x-full')
  })

  it('applies the on-screen translate class when open', () => {
    render(<MobileDrawer side="right" open onClose={() => {}}><p>x</p></MobileDrawer>)
    expect(screen.getByTestId('drawer-panel').className).toContain('translate-x-0')
  })

  it('applies the left off-screen translate class when closed', () => {
    render(<MobileDrawer side="left" open={false} onClose={() => {}}><p>x</p></MobileDrawer>)
    expect(screen.getByTestId('drawer-panel').className).toContain('-translate-x-full')
  })

  it('wraps keyboard focus through form controls', async () => {
    render(<MobileDrawer side="right" open onClose={() => {}}>
      <input aria-label="Distance" />
      <select aria-label="Unit"><option>mm</option></select><button>Apply</button>
    </MobileDrawer>)
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Distance' }))
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Unit' }))
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Apply' }))
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Distance' }))
  })

  it('excludes collapsed tools from focus wrapping', async () => {
    render(<MobileDrawer side="right" open onClose={() => {}}>
      <button>Visible tool</button>
      <div hidden><button>Hidden action</button></div>
    </MobileDrawer>)
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Visible tool' }))
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Visible tool' }))
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(<MobileDrawer side="left" open onClose={onClose}><button>Inside</button></MobileDrawer>)

    await userEvent.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledOnce()
  })
})
