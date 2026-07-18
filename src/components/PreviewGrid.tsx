import { useEffect, useState } from 'react'
import { useViewerStore } from '../store/viewerStore'
import { listGridFiles } from '../services/gridFiles'
import type { GridFile, GridListing } from '../services/gridFiles'
import { GridTile } from './GridTile'
import { breadcrumbsFor } from '../utils/pathUtils'

const PAGE_SIZE = 60

export function sortGridFiles(files: GridFile[], sort: 'name' | 'size' | 'mtime'): GridFile[] {
  const sorted = [...files]
  if (sort === 'size') sorted.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name))
  else if (sort === 'mtime') sorted.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name))
  else sorted.sort((a, b) => a.name.localeCompare(b.name))
  return sorted
}

export function PreviewGrid() {
  const gridFolder = useViewerStore((s) => s.gridFolder)
  const gridScope = useViewerStore((s) => s.gridScope)
  const gridSort = useViewerStore((s) => s.gridSort)
  const dirPath = useViewerStore((s) => s.dirPath)
  const [listing, setListing] = useState<GridListing>({ folders: [], files: [] })
  const [loading, setLoading] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  useEffect(() => {
    if (!gridFolder) return
    let cancelled = false
    setLoading(true)
    setListing({ folders: [], files: [] })
    setVisibleCount(PAGE_SIZE)
    listGridFiles(gridFolder, gridScope === 'recursive')
      .then((res) => { if (!cancelled) setListing(res) })
      .catch((err) => {
        if (!cancelled) {
          setListing({ folders: [], files: [] })
          useViewerStore.getState().setError(err instanceof Error ? err.message : String(err))
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [gridFolder, gridScope])

  const total = listing.files.length
  const entries = [
    ...listing.folders.map((folder) => ({ kind: 'folder' as const, folder })),
    ...sortGridFiles(listing.files, gridSort).map((file) => ({ kind: 'file' as const, file })),
  ]
  const visibleEntries = entries.slice(0, visibleCount)

  const crumbs = dirPath && gridFolder ? breadcrumbsFor(dirPath, gridFolder) : []

  return (
    <div className="w-full h-full flex flex-col bg-[var(--bg-app)] overflow-hidden">
      {/* Breadcrumb trail — navigate back up the folder hierarchy */}
      {crumbs.length > 1 && (
        <nav aria-label="Folder path" className="flex items-center gap-1 px-4 pt-2 text-xs shrink-0 flex-wrap">
          {crumbs.map((crumb, index) => (
            <span key={crumb.path} className="flex items-center gap-1 min-w-0">
              {index > 0 && <span aria-hidden="true" className="text-[var(--text-muted)]">/</span>}
              {index === crumbs.length - 1 ? (
                <span className="text-[var(--text-primary)] truncate" aria-current="location">{crumb.name}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => useViewerStore.getState().setGridFolder(crumb.path)}
                  className="text-[var(--accent)] hover:text-[var(--accent-hover)] truncate"
                >
                  {crumb.name}
                </button>
              )}
            </span>
          ))}
        </nav>
      )}

      {/* Toolbar row: scope toggle + sort + count */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] shrink-0">
        <div className="flex rounded overflow-hidden border border-[var(--border-input)]">
          {(['current', 'recursive'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={gridScope === s}
              onClick={() => useViewerStore.getState().setGridScope(s)}
              className={[
                'px-2.5 py-1 text-xs transition-colors',
                gridScope === s
                  ? 'bg-[var(--bg-button-active)] text-[var(--text-bright)]'
                  : 'bg-[var(--bg-button)] text-[var(--text-muted)] hover:text-[var(--text-primary)]',
              ].join(' ')}
            >
              {s === 'current' ? 'This folder' : 'All subfolders'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
          <span className="sr-only">Sort files by</span>
          <select
            aria-label="Sort files by"
            value={gridSort}
            onChange={(event) => useViewerStore.getState().setGridSort(event.target.value as 'name' | 'size' | 'mtime')}
            className="h-6 rounded border border-[var(--border-input)] bg-[var(--bg-input)] px-1.5 text-xs text-[var(--text-primary)]"
          >
            <option value="name">Name</option>
            <option value="size">Size</option>
            <option value="mtime">Modified</option>
          </select>
        </label>
        <span className="text-xs text-[var(--text-muted)] font-mono tabular-nums">
          {loading ? 'scanning...' : `${total} file${total === 1 ? '' : 's'}`}
        </span>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {!loading && total === 0 && listing.folders.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No supported 3D files in this folder.</p>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
            {visibleEntries.map((entry) => entry.kind === 'folder' ? (
              <button
                key={entry.folder.path}
                type="button"
                onClick={() => useViewerStore.getState().setGridFolder(entry.folder.path)}
                aria-label={`Open folder ${entry.folder.name}`}
                title={entry.folder.name}
                className="flex flex-col items-center justify-center gap-2 aspect-square rounded border border-[var(--border)] bg-[var(--bg-panel)] hover:border-[var(--accent)] transition-colors text-[var(--text-label)]"
              >
                <svg className="w-8 h-8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
                  <path strokeLinejoin="round" d="M1.75 4.25a1 1 0 011-1h3l1.5 1.5h5.5a1 1 0 011 1v6a1 1 0 01-1 1H2.75a1 1 0 01-1-1v-7.5z" />
                </svg>
                <span className="truncate max-w-full px-2 text-xs text-[var(--text-primary)]">{entry.folder.name}</span>
              </button>
            ) : (
              <GridTile key={entry.file.path} file={entry.file} />
            ))}
          </div>
        )}
        {!loading && visibleEntries.length < entries.length && (
          <div className="flex justify-center pt-4">
            <button
              type="button"
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              className="px-4 py-2 rounded bg-[var(--bg-button)] text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]"
            >
              Load more ({entries.length - visibleEntries.length} remaining)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
