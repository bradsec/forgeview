import { useCallback, useEffect, useRef, useState } from 'react'
import { useViewerStore } from '../store/viewerStore'
import type { DirTreeEntry } from '../store/viewerStore'
import { useDirOpen } from '../hooks/useDirOpen'
import { basename } from '../utils/pathUtils'

const MIN_WIDTH = 140
const MAX_WIDTH = 500
const DEFAULT_WIDTH = 224
const PAGE_SIZE = 100

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function TreeNodes({
  entries,
  depth,
  expandDir,
  collapseDir,
  resetKey,
}: {
  entries: DirTreeEntry[]
  depth: number
  expandDir: (path: string) => Promise<void>
  collapseDir: (path: string) => void
  resetKey: string
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  useEffect(() => setVisibleCount(PAGE_SIZE), [resetKey])

  const visibleEntries = entries.slice(0, visibleCount)
  return (
    <>
      {visibleEntries.map((entry) => (
        <TreeNode
          key={entry.fullPath}
          entry={entry}
          depth={depth}
          expandDir={expandDir}
          collapseDir={collapseDir}
        />
      ))}
      {visibleEntries.length < entries.length && (
        <li style={{ paddingLeft: 12 + depth * 16 }} className="pr-4 py-1">
          <button
            type="button"
            onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            className="text-xs text-[var(--accent)] hover:text-[var(--accent-hover)]"
          >
            Load more ({entries.length - visibleEntries.length} remaining)
          </button>
        </li>
      )}
    </>
  )
}

function TreeNode({
  entry,
  depth,
  expandDir,
  collapseDir,
}: {
  entry: DirTreeEntry
  depth: number
  expandDir: (path: string) => Promise<void>
  collapseDir: (path: string) => void
}) {
  const activeFilePath = useViewerStore((s) => s.activeFilePath)
  const loadedModels = useViewerStore((s) => s.loadedModels)
  const isActive = !entry.isDirectory && entry.fullPath === activeFilePath
  // Only check loadedModels — preview-only files do not get the minus button
  const inScene = !entry.isDirectory && loadedModels.some((m) => m.path === entry.fullPath)

  const handleClick = () => {
    if (entry.isDirectory) {
      if (entry.isExpanded) {
        collapseDir(entry.fullPath)
      } else {
        expandDir(entry.fullPath)
      }
    } else {
      useViewerStore.getState().setFile(entry.fullPath, entry.name, entry.extension!, entry.sizeBytes!)
      useViewerStore.getState().setActiveFile(entry.fullPath)
    }
  }

  const paddingLeft = 12 + depth * 16

  return (
    <>
      <li
        onClick={handleClick}
        className={[
          'flex items-center gap-1.5 pr-4 py-0.5 cursor-pointer text-sm select-none',
          isActive
            ? 'bg-[var(--bg-button-active)] text-[var(--text-bright)]'
            : 'text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]/50',
        ].join(' ')}
        style={{ paddingLeft }}
      >
        {/* Chevron / spacer */}
        {entry.isDirectory ? (
          <span className="w-4 text-center text-xs text-[var(--text-muted)] shrink-0">
            {entry.isExpanded ? '\u25BE' : '\u25B8'}
          </span>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Icon \u2014 folder state is already conveyed by the chevron, so the
            folder glyph stays constant. One SVG icon family, token-colored. */}
        {entry.isDirectory ? (
          <svg
            className="w-3.5 h-3.5 shrink-0 text-[var(--text-label)]"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            aria-hidden="true"
          >
            <path
              strokeLinejoin="round"
              d="M1.75 4.25a1 1 0 011-1h3l1.5 1.5h5.5a1 1 0 011 1v6a1 1 0 01-1 1H2.75a1 1 0 01-1-1v-7.5z"
            />
          </svg>
        ) : (
          <span className="bg-[var(--bg-button)] text-[10px] rounded font-mono px-1 py-0 shrink-0 leading-tight">
            {entry.extension?.toUpperCase().replace('.', '')}
          </span>
        )}

        {/* Name */}
        <span className="truncate flex-1" title={entry.name}>
          {entry.name}
        </span>

        {/* File size */}
        {!entry.isDirectory && entry.sizeBytes !== undefined && (
          <span className="text-[10px] text-[var(--text-muted)] shrink-0 font-mono tabular-nums">
            {formatBytes(entry.sizeBytes)}
          </span>
        )}

        {/* Add/remove from scene button (files only) */}
        {!entry.isDirectory && (
          inScene ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                const state = useViewerStore.getState()
                const model = state.loadedModels.find((m) => m.path === entry.fullPath)
                if (model) state.removeModel(model.id)
              }}
              className="text-[var(--error)] hover:bg-[var(--bg-button)] text-sm font-bold shrink-0 leading-none ml-1 w-5 h-5 flex items-center justify-center rounded"
              aria-label={`Remove ${entry.name}`}
              title="Remove from scene"
            >
              &minus;
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation()
                const id = crypto.randomUUID()
                useViewerStore.getState().addModel({
                  id,
                  path: entry.fullPath,
                  name: entry.name,
                  extension: entry.extension!,
                  sizeBytes: entry.sizeBytes!,
                  triangleCount: 0,
                })
              }}
              className="text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-button)] text-sm font-bold shrink-0 leading-none ml-1 w-5 h-5 flex items-center justify-center rounded"
              aria-label={`Add ${entry.name} to scene`}
              title="Add to scene"
            >
              +
            </button>
          )
        )}
      </li>

      {/* Children */}
      {entry.isDirectory && entry.isExpanded && entry.children && (
        <TreeNodes
          entries={entry.children}
          depth={depth + 1}
          expandDir={expandDir}
          collapseDir={collapseDir}
          resetKey={entry.fullPath}
        />
      )}
    </>
  )
}

/**
 * VS Code-style directory tree panel with expandable sub-directories.
 * Returns null when no directory is selected.
 */
export function DirectoryPanel({ mobile = false }: { mobile?: boolean } = {}) {
  const dirPath = useViewerStore((s) => s.dirPath)
  const dirTree = useViewerStore((s) => s.dirTree)
  const explorerVisible = useViewerStore((s) => s.explorerVisible)
  const { expandDir, collapseDir } = useDirOpen()
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const isDragging = useRef(false)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    const startX = e.clientX
    const startWidth = width

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + ev.clientX - startX))
      setWidth(newWidth)
    }

    const onMouseUp = () => {
      isDragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
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

  if (dirPath === null) return null
  if (!mobile && !explorerVisible) return null

  const dirName = basename(dirPath.replace(/[/\\]+$/, '')) || dirPath

  const close = () =>
    mobile
      ? useViewerStore.getState().setMobileDrawer('none')
      : useViewerStore.getState().setExplorerVisible(false)

  return (
    <aside
      className={
        mobile
          ? 'relative bg-[var(--bg-panel)] flex flex-col h-full w-full overflow-hidden'
          : 'relative bg-[var(--bg-panel)] hidden md:flex flex-col shrink-0 overflow-hidden'
      }
      style={mobile ? undefined : { width }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <h2 className="text-[11px] font-semibold text-[var(--text-label)] uppercase tracking-wide">
          Explorer
        </h2>
        <button
          onClick={close}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm leading-none"
          aria-label="Close Explorer"
          title="Close Explorer"
        >
          &times;
        </button>
      </div>
      <p
        className="text-xs text-[var(--text-muted)] px-4 pb-1.5 truncate font-medium"
        title={dirPath}
      >
        {dirName}
      </p>

      {dirTree.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] px-4 pb-3">No supported files found</p>
      ) : (
        <ul className="overflow-y-auto flex-1 pb-1">
          <TreeNodes
            entries={dirTree}
            depth={0}
            expandDir={expandDir}
            collapseDir={collapseDir}
            resetKey={dirPath}
          />
        </ul>
      )}

      {/* Resize handle — right edge, wider hit area */}
      {!mobile && (
        <div
          onMouseDown={handleMouseDown}
          className="absolute top-0 -right-1 w-3 h-full cursor-col-resize z-10 group"
        >
          <div className="absolute top-0 right-1 w-1 h-full group-hover:bg-[var(--accent)]/50 group-active:bg-[var(--accent)]/70 transition-colors" />
        </div>
      )}
    </aside>
  )
}
