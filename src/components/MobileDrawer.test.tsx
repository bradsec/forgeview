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
})
