import { useEffect, useRef, useState } from 'react'
import { useViewerStore } from '../store/viewerStore'
import type { Viewer3DHandle } from './Viewer3D'

interface SceneContextMenuProps {
  viewerRef: React.RefObject<Viewer3DHandle | null>
  children: React.ReactNode
}

interface MenuPosition {
  x: number
  y: number
}

export function SceneContextMenu({ viewerRef, children }: SceneContextMenuProps) {
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const projectionMode = useViewerStore((state) => state.projectionMode)
  const viewMode = useViewerStore((state) => state.viewMode)

  useEffect(() => {
    if (!position) return

    const menu = menuRef.current
    if (menu) {
      const rect = menu.getBoundingClientRect()
      const margin = 8
      setPosition((current) => current && ({
        x: Math.max(margin, Math.min(current.x, window.innerWidth - rect.width - margin)),
        y: Math.max(margin, Math.min(current.y, window.innerHeight - rect.height - margin)),
      }))
      menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    }

    const close = () => setPosition(null)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [position?.x, position?.y])

  const run = (action: () => void) => {
    setPosition(null)
    action()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      setPosition(null)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      items[(index + 1) % items.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      items[(index - 1 + items.length) % items.length]?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      items[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      items[items.length - 1]?.focus()
    }
  }

  return (
    <div
      className="relative h-full w-full"
      onContextMenu={(event) => {
        event.preventDefault()
        setPosition({ x: event.clientX, y: event.clientY })
      }}
    >
      {children}
      {position && (
        <>
          <button
            type="button"
            aria-label="Close scene menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setPosition(null)}
            onContextMenu={(event) => {
              event.preventDefault()
              setPosition({ x: event.clientX, y: event.clientY })
            }}
          />
          <div
            ref={menuRef}
            role="menu"
            aria-label="Scene actions"
            className="scene-context-menu"
            style={{ left: position.x, top: position.y }}
            onKeyDown={handleKeyDown}
          >
            <button role="menuitem" className="app-menu-item" onClick={() => run(() => viewerRef.current?.fitAll())}>Fit all</button>
            <button role="menuitem" className="app-menu-item" onClick={() => run(() => viewerRef.current?.resetCamera())}>Reset camera</button>
            <div className="menu-separator" role="separator" />
            <div className="menu-heading">Standard view</div>
            {(['front', 'top', 'right'] as const).map((direction) => (
              <button key={direction} role="menuitem" className="app-menu-item capitalize" onClick={() => run(() => viewerRef.current?.snapToView(direction))}>{direction}</button>
            ))}
            <div className="menu-separator" role="separator" />
            <button
              role="menuitem"
              className="app-menu-item"
              onClick={() => run(() => useViewerStore.getState().setProjectionMode(projectionMode === 'perspective' ? 'orthographic' : 'perspective'))}
            >
              <span>{projectionMode === 'perspective' ? 'Orthographic projection' : 'Perspective projection'}</span>
            </button>
            <div className="menu-heading">Display</div>
            {(['solid', 'wireframe', 'points'] as const).map((mode) => (
              <button key={mode} role="menuitem" className="app-menu-item capitalize" onClick={() => run(() => useViewerStore.getState().setViewMode(mode))}>
                <span>{mode}</span>
                {viewMode === mode && <span aria-hidden="true" className="menu-check">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
