import { ViewCube } from './ViewCube'
import { useViewerStore } from '../store/viewerStore'
import type { Viewer3DHandle } from './Viewer3D'
import type { ViewDirection } from '../utils/cameraActions'
import * as THREE from 'three'

interface SceneControlsProps {
  viewerRef: React.RefObject<Viewer3DHandle | null>
}

function IconButton({
  onClick,
  title,
  children,
  active,
}: {
  onClick: () => void
  title: string
  children: React.ReactNode
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={[
        'w-8 h-8 flex items-center justify-center rounded text-xs font-medium transition-colors',
        active
          ? 'bg-[var(--bg-button-active)] text-[var(--text-bright)]'
          : 'text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)] hover:text-[var(--text-bright)]',
      ].join(' ')}
      style={active ? undefined : { backgroundColor: 'color-mix(in srgb, var(--bg-button) 80%, transparent)' }}
    >
      {children}
    </button>
  )
}

export function SceneControls({ viewerRef }: SceneControlsProps) {
  const projectionMode = useViewerStore((s) => s.projectionMode)

  const handleSnap = (direction: ViewDirection) => {
    viewerRef.current?.snapToView(direction)
  }

  const handleFitAll = () => {
    viewerRef.current?.fitAll()
  }

  const handleReset = () => {
    viewerRef.current?.resetCamera()
  }

  const handleZoomIn = () => {
    viewerRef.current?.zoomIn()
  }

  const handleZoomOut = () => {
    viewerRef.current?.zoomOut()
  }

  const handleToggleProjection = () => {
    const next = projectionMode === 'perspective' ? 'orthographic' : 'perspective'
    useViewerStore.getState().setProjectionMode(next)
  }

  const handleOrbitBy = (deltaTheta: number, deltaPhi: number) => {
    viewerRef.current?.orbitBy(deltaTheta, deltaPhi)
  }

  const getCamera = (): THREE.PerspectiveCamera | THREE.OrthographicCamera | undefined => {
    return viewerRef.current?.getCamera()
  }

  return (
    <>
      <div className="absolute top-3 right-3 z-20">
        <ViewCube onSnapToView={handleSnap} onOrbitBy={handleOrbitBy} getCamera={getCamera} />
      </div>
      <nav
        aria-label="Camera navigation"
        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 rounded p-1.5 shadow-[0_4px_18px_var(--shadow-color)]"
        style={{ backgroundColor: 'color-mix(in srgb, var(--bg-panel) 88%, transparent)' }}
      >
        <label className="sr-only" htmlFor="standard-view">Standard view</label>
        <select
          id="standard-view"
          aria-label="Standard view"
          defaultValue=""
          onChange={(event) => {
            if (event.target.value) handleSnap(event.target.value as ViewDirection)
            event.target.value = ''
          }}
          className="h-8 max-w-28 rounded border border-[var(--border-input)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-primary)]"
        >
          <option value="" disabled>Views</option>
          <option value="front">Front</option>
          <option value="back">Back</option>
          <option value="top">Top</option>
          <option value="bottom">Bottom</option>
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
        <IconButton onClick={handleFitAll} title="Fit All (zoom to fit all objects)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="10" height="10" rx="1" />
            <path d="M1 5V2a1 1 0 011-1h3M11 1h3a1 1 0 011 1v3M15 11v3a1 1 0 01-1 1h-3M5 15H2a1 1 0 01-1-1v-3" />
          </svg>
        </IconButton>

        <IconButton onClick={handleReset} title="Reset Camera">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 8a6 6 0 0110.47-4M14 8a6 6 0 01-10.47 4" />
            <path d="M12 1v3h-3M4 15v-3h3" />
          </svg>
        </IconButton>

        <div className="w-px h-6 bg-[var(--border)] mx-0.5" />

        <IconButton onClick={handleZoomIn} title="Zoom In">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="5" />
            <path d="M7 5v4M5 7h4M11 11l3.5 3.5" />
          </svg>
        </IconButton>

        <IconButton onClick={handleZoomOut} title="Zoom Out">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="5" />
            <path d="M5 7h4M11 11l3.5 3.5" />
          </svg>
        </IconButton>

        <div className="w-px h-6 bg-[var(--border)] mx-0.5" />

        <IconButton
          onClick={handleToggleProjection}
          title={projectionMode === 'perspective' ? 'Switch to Orthographic' : 'Switch to Perspective'}
          active={projectionMode === 'orthographic'}
        >
          {projectionMode === 'perspective' ? 'P' : 'O'}
        </IconButton>
      </nav>
    </>
  )
}
