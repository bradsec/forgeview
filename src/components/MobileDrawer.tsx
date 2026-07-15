import { useEffect, useRef } from 'react'
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
  const panelRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const label = side === 'left' ? 'Explorer' : 'Details'
  const id = side === 'left' ? 'mobile-explorer-drawer' : 'mobile-details-drawer'

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    return () => previousFocusRef.current?.focus()
  }, [open])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !panelRef.current) return
    const focusable = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    )
    if (focusable.length === 0) {
      event.preventDefault()
      panelRef.current.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

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
        ref={panelRef}
        id={id}
        data-testid="drawer-panel"
        inert={!open}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-hidden={!open}
        tabIndex={open ? -1 : undefined}
        onKeyDown={handleKeyDown}
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
