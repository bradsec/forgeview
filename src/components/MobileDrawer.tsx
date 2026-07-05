import type { ReactNode } from 'react'

interface MobileDrawerProps {
  side: 'left' | 'right'
  open: boolean
  onClose: () => void
  children: ReactNode
}

/**
 * Mobile-only (`md:hidden`) off-canvas drawer: a scrim plus a fixed panel that
 * slides in from the given side. Desktop renders panels in-flow instead, so
 * this whole component is hidden at `>= md`.
 */
export function MobileDrawer({ side, open, onClose, children }: MobileDrawerProps) {
  const offscreen = side === 'left' ? '-translate-x-full' : 'translate-x-full'
  return (
    <div className="md:hidden">
      {open && (
        <div
          data-testid="drawer-scrim"
          onClick={onClose}
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-[var(--scrim)]"
        />
      )}
      <div
        data-testid="drawer-panel"
        inert={!open}
        className={[
          'fixed inset-y-0 z-40 w-[80vw] max-w-xs bg-[var(--bg-panel)] overflow-hidden transition-transform',
          side === 'left' ? 'left-0' : 'right-0',
          open ? 'translate-x-0' : offscreen,
        ].join(' ')}
      >
        {children}
      </div>
    </div>
  )
}
