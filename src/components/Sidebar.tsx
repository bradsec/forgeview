import '../styles/prepare-panel.css'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useViewerStore } from '../store/viewerStore'
import { ModelList } from './ModelList'
import { PreparePanel } from './prepare/PreparePanel'
import { UnitPrompt } from './prepare/UnitPrompt'
import { DimensionsReadout } from './prepare/DimensionsReadout'
import type { Viewer3DHandle } from './Viewer3D'

const MIN_WIDTH = 320
const MAX_WIDTH = 440
const DEFAULT_WIDTH = 352

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Right panel with Details / Prepare tabs; resizable via the left-edge handle; close control lives in the tab strip.
 */
export function Sidebar({ mobile = false, onUndoEdit, viewerRef }: {
  mobile?: boolean
  onUndoEdit?: (steps?: number) => void
  viewerRef: React.RefObject<Viewer3DHandle | null>
} = { viewerRef: { current: null } }) {
  const uid = useId()
  const fileName = useViewerStore((s) => s.fileName)
  const fileExtension = useViewerStore((s) => s.fileExtension)
  const fileSize = useViewerStore((s) => s.fileSize)
  const triangleCount = useViewerStore((s) => s.triangleCount)
  const geometryDetails = useViewerStore((s) => s.geometryDetails)
  const isLoading = useViewerStore((s) => s.isLoading)
  const error = useViewerStore((s) => s.error)
  const sidebarVisible = useViewerStore((s) => (mobile ? true : s.sidebarVisible))
  const rightPanelTab = useViewerStore((s) => s.rightPanelTab)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth)
  const maxWidth = viewportWidth < 1280 ? MIN_WIDTH : MAX_WIDTH
  const panelWidth = Math.min(width, maxWidth)
  const isDragging = useRef(false)
  const dragCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => () => dragCleanupRef.current?.(), [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    const startX = e.clientX
    const startWidth = panelWidth

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return
      // Dragging left edge: moving left increases width
      const newWidth = Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth - (ev.clientX - startX)))
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
  }, [panelWidth, maxWidth])

  // Clamp width when window resizes so panel doesn't overflow
  useEffect(() => {
    if (mobile) return
    const onResize = () => {
      setViewportWidth(window.innerWidth)
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

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const order = ['details', 'prepare'] as const
    const current = order.indexOf(rightPanelTab)
    let next: (typeof order)[number] | undefined
    if (event.key === 'ArrowRight') next = order[(current + 1) % order.length]
    else if (event.key === 'ArrowLeft') next = order[(current - 1 + order.length) % order.length]
    else if (event.key === 'Home') next = order[0]
    else if (event.key === 'End') next = order[order.length - 1]
    if (!next) return
    event.preventDefault()
    useViewerStore.getState().setRightPanelTab(next)
    document.getElementById(`${uid}-tab-${next}`)?.focus()
  }

  return (
    <aside
      className={
        mobile
          ? 'inspector relative bg-[var(--bg-panel)] flex flex-col h-full w-full overflow-hidden'
          : 'inspector relative bg-[var(--bg-panel)] border-l border-[var(--border)] hidden md:flex flex-col shrink-0 overflow-hidden'
      }
      style={mobile ? undefined : { width: panelWidth }}
    >
      {!mobile && (
        <div
          onMouseDown={handleMouseDown}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault()
              setWidth((value) => Math.min(maxWidth, value + 10))
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
          aria-valuemax={maxWidth}
          aria-valuenow={panelWidth}
          tabIndex={0}
          className="absolute top-0 -left-1 w-3 h-full cursor-col-resize z-10 group"
        >
          <div className="absolute top-0 left-1 w-1 h-full group-hover:bg-[var(--accent)]/50 group-active:bg-[var(--accent)]/70 transition-colors" />
        </div>
      )}

      <div className="inspector-tabs flex items-center border-b border-[var(--border)] px-2">
        <div
          role="tablist"
          aria-label="Right panel"
          onKeyDown={onTabKeyDown}
          className="flex gap-1"
        >
          {(['details', 'prepare'] as const).map((tab) => (
            <button
              key={tab}
              id={`${uid}-tab-${tab}`}
              role="tab"
              type="button"
              aria-selected={rightPanelTab === tab}
              aria-controls={`${uid}-tabpanel-${tab}`}
              tabIndex={rightPanelTab === tab ? 0 : -1}
              onClick={() => useViewerStore.getState().setRightPanelTab(tab)}
              className={`px-3 py-1.5 text-sm rounded-t ${
                rightPanelTab === tab
                  ? 'bg-[var(--bg-app)] text-[var(--text-bright)]'
                  : 'text-[var(--text-label)]'
              }`}
            >
              {tab === 'details' ? 'Details' : 'Prepare'}
            </button>
          ))}
        </div>
        <button
          onClick={close}
          className="ml-auto text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm leading-none"
          aria-label="Close Sidebar"
          title="Close Sidebar"
        >
          &times;
        </button>
      </div>

      {rightPanelTab === 'details' ? (
        <div
          role="tabpanel"
          id={`${uid}-tabpanel-details`}
          aria-labelledby={`${uid}-tab-details`}
          tabIndex={0}
          className="flex flex-col flex-1 min-h-0 overflow-y-auto"
        >
          {/* Scene Models section */}
          <div className="flex flex-col">
            <div className="px-4 pt-4 pb-2">
              <h2 className="text-sm font-semibold text-[var(--text-label)]">
                Scene Models
              </h2>
            </div>
            <ModelList />
          </div>

          {/* Separator between scene models and file info */}
          <div className="border-t border-[var(--border)]" />

          <div className="p-4 flex flex-col">
            <h2 className="text-sm font-semibold text-[var(--text-label)]">File Info</h2>

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
                  <dt className="text-xs text-[var(--text-muted)] mb-0.5">Name</dt>
                  <dd className="text-sm text-[var(--text-primary)] break-words" title={fileName}>
                    {fileName}
                  </dd>
                </div>

                {/* Format */}
                {fileExtension && (
                  <div>
                    <dt className="text-xs text-[var(--text-muted)] mb-0.5">Format</dt>
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
                    <dt className="text-xs text-[var(--text-muted)] mb-0.5">Size</dt>
                    <dd className="text-sm text-[var(--text-primary)] font-mono tabular-nums">{formatBytes(fileSize)}</dd>
                  </div>
                )}

                {/* Triangle count */}
                <div>
                  <dt className="text-xs text-[var(--text-muted)] mb-0.5">Triangles</dt>
                  <dd className="text-sm text-[var(--text-primary)] font-mono tabular-nums">
                    {triangleCount !== null ? triangleCount.toLocaleString() : 'N/A'}
                  </dd>
                </div>
              </dl>
            )}
            {geometryDetails && (
              <>
                <h2 className="text-sm font-semibold text-[var(--text-label)] mt-6">Geometry</h2>
                <dl className="mt-3 grid grid-cols-2 gap-3">
                  <div><dt className="text-xs text-[var(--text-muted)]">Vertices</dt><dd className="text-sm font-mono tabular-nums">{geometryDetails.vertices.toLocaleString()}</dd></div>
                  <div><dt className="text-xs text-[var(--text-muted)]">Meshes</dt><dd className="text-sm font-mono tabular-nums">{geometryDetails.meshes.toLocaleString()}</dd></div>
                  <div><dt className="text-xs text-[var(--text-muted)]">Boundary edges</dt><dd className="text-sm font-mono tabular-nums">{geometryDetails.boundaryEdges.toLocaleString()}</dd></div>
                  <div><dt className="text-xs text-[var(--text-muted)]">Non-manifold</dt><dd className="text-sm font-mono tabular-nums">{geometryDetails.nonManifoldEdges.toLocaleString()}</dd></div>
                </dl>
              </>
            )}
            <UnitPrompt viewerRef={viewerRef} />
            <DimensionsReadout />
          </div>
        </div>
      ) : (
        <div
          role="tabpanel"
          id={`${uid}-tabpanel-prepare`}
          aria-labelledby={`${uid}-tab-prepare`}
          tabIndex={0}
          className="inspector-prepare flex-1 min-h-0 overflow-y-auto"
        >
          <PreparePanel onUndoEdit={onUndoEdit} viewerRef={viewerRef} />
        </div>
      )}
    </aside>
  )
}
