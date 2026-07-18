import { useCallback, useEffect, useRef, useState } from 'react'
import { useViewerStore } from '../store/viewerStore'
import { ModelList } from './ModelList'

const MIN_WIDTH = 140
const MAX_WIDTH = 500
const DEFAULT_WIDTH = 256

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Right-side panel showing scene models and file metadata.
 * Resizable via left-edge drag handle. Closable via header button.
 */
export function Sidebar({ mobile = false }: { mobile?: boolean } = {}) {
  const fileName = useViewerStore((s) => s.fileName)
  const fileExtension = useViewerStore((s) => s.fileExtension)
  const fileSize = useViewerStore((s) => s.fileSize)
  const triangleCount = useViewerStore((s) => s.triangleCount)
  const geometryDetails = useViewerStore((s) => s.geometryDetails)
  const isLoading = useViewerStore((s) => s.isLoading)
  const error = useViewerStore((s) => s.error)
  const sidebarVisible = useViewerStore((s) => (mobile ? true : s.sidebarVisible))
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const isDragging = useRef(false)
  const dragCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => () => dragCleanupRef.current?.(), [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    const startX = e.clientX
    const startWidth = width

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return
      // Dragging left edge: moving left increases width
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth - (ev.clientX - startX)))
      setWidth(newWidth)
    }

    const cleanup = () => {
      isDragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      dragCleanupRef.current = null
    }
    const onMouseUp = () => cleanup()

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    dragCleanupRef.current?.()
    dragCleanupRef.current = cleanup
  }, [width])

  // Clamp width when window resizes so panel doesn't overflow
  useEffect(() => {
    if (mobile) return
    const onResize = () => {
      const maxAllowed = Math.floor(window.innerWidth * 0.4)
      setWidth((w) => Math.min(w, Math.max(MIN_WIDTH, maxAllowed)))
    }
    window.addEventListener('resize', onResize)
    onResize()
    return () => window.removeEventListener('resize', onResize)
  }, [mobile])

  if (!mobile && !sidebarVisible) {
    return <aside className="hidden" />
  }

  const close = () =>
    mobile
      ? useViewerStore.getState().setMobileDrawer('none')
      : useViewerStore.getState().setSidebarVisible(false)

  return (
    <aside
      className={
        mobile
          ? 'relative bg-[var(--bg-panel)] flex flex-col h-full w-full overflow-y-auto overflow-x-hidden'
          : 'relative bg-[var(--bg-panel)] border-l border-[var(--border)] hidden md:flex flex-col shrink-0 overflow-y-auto overflow-x-hidden'
      }
      style={mobile ? undefined : { width }}
    >
      {!mobile && (
        <div
          onMouseDown={handleMouseDown}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault()
              setWidth((value) => Math.min(MAX_WIDTH, value + 10))
            }
            if (event.key === 'ArrowRight') {
              event.preventDefault()
              setWidth((value) => Math.max(MIN_WIDTH, value - 10))
            }
          }}
          role="separator"
          aria-label="Resize Details"
          aria-orientation="vertical"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          className="absolute top-0 -left-1 w-3 h-full cursor-col-resize z-10 group"
        >
          <div className="absolute top-0 left-1 w-1 h-full group-hover:bg-[var(--accent)]/50 group-active:bg-[var(--accent)]/70 transition-colors" />
        </div>
      )}

      {/* Scene Models section */}
      <div className="flex flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 className="text-sm font-semibold text-[var(--text-label)] uppercase tracking-wide">
            Scene Models
          </h2>
          <button
            onClick={close}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm leading-none"
            aria-label="Close Sidebar"
            title="Close Sidebar"
          >
            &times;
          </button>
        </div>
        <ModelList />
      </div>

      {/* Separator between scene models and file info */}
      <div className="border-t border-[var(--border)]" />

      <div className="p-4 flex flex-col flex-1 overflow-y-auto">
      <h2 className="text-sm font-semibold text-[var(--text-label)] uppercase tracking-wide">File Info</h2>

      {isLoading && (
        <p className="text-sm text-[var(--text-label)] mt-3">Loading...</p>
      )}

      {error && (
        <p className="text-[var(--error)] text-sm mt-3 break-words">{error}</p>
      )}

      {!fileName && !isLoading && !error && (
        <p className="text-sm text-[var(--text-muted)] mt-2">No file loaded</p>
      )}

      {fileName && (
        <dl className="mt-3 flex flex-col gap-3">
          {/* Name */}
          <div>
            <dt className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-0.5">Name</dt>
            <dd className="text-sm text-[var(--text-primary)] truncate" title={fileName}>
              {fileName}
            </dd>
          </div>

          {/* Format */}
          {fileExtension && (
            <div>
              <dt className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-0.5">Format</dt>
              <dd>
                <span className="inline-block px-2 py-0.5 bg-[var(--bg-button)] text-[var(--text-primary)] text-xs rounded font-mono">
                  {fileExtension.toUpperCase().replace('.', '')}
                </span>
              </dd>
            </div>
          )}

          {/* Size */}
          {fileSize !== null && (
            <div>
              <dt className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-0.5">Size</dt>
              <dd className="text-sm text-[var(--text-primary)] font-mono tabular-nums">{formatBytes(fileSize)}</dd>
            </div>
          )}

          {/* Triangle count */}
          <div>
            <dt className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-0.5">Triangles</dt>
            <dd className="text-sm text-[var(--text-primary)] font-mono tabular-nums">
              {triangleCount !== null ? triangleCount.toLocaleString() : 'N/A'}
            </dd>
          </div>
        </dl>
      )}
      {geometryDetails && (
        <>
          <h2 className="text-sm font-semibold text-[var(--text-label)] uppercase tracking-wide mt-6">Geometry</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <div><dt className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Vertices</dt><dd className="text-sm font-mono tabular-nums">{geometryDetails.vertices.toLocaleString()}</dd></div>
            <div><dt className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Meshes</dt><dd className="text-sm font-mono tabular-nums">{geometryDetails.meshes.toLocaleString()}</dd></div>
            <div><dt className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Mesh health</dt><dd className="text-sm">{geometryDetails.watertight ? 'Watertight' : 'Needs repair'}</dd></div>
            <div><dt className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Boundary edges</dt><dd className="text-sm font-mono tabular-nums">{geometryDetails.boundaryEdges.toLocaleString()}</dd></div>
            <div><dt className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Non-manifold</dt><dd className="text-sm font-mono tabular-nums">{geometryDetails.nonManifoldEdges.toLocaleString()}</dd></div>
          </dl>
        </>
      )}
      </div>
    </aside>
  )
}
