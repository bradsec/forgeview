import { useEffect, useState } from 'react'
import { useViewerStore } from '../store/viewerStore'
import { listGridFiles } from '../services/gridFiles'
import type { GridListing } from '../services/gridFiles'
import { GridTile } from './GridTile'

export function PreviewGrid() {
  const gridFolder = useViewerStore((s) => s.gridFolder)
  const gridScope = useViewerStore((s) => s.gridScope)
  const [listing, setListing] = useState<GridListing>({ folders: [], files: [] })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!gridFolder) return
    let cancelled = false
    setLoading(true)
    setListing({ folders: [], files: [] })
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

  return (
    <div className="w-full h-full flex flex-col bg-[var(--bg-app)] overflow-hidden">
      {/* Toolbar row: scope toggle + count */}
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
            {listing.folders.map((folder) => (
              <button
                key={folder.path}
                type="button"
                onClick={() => useViewerStore.getState().setGridFolder(folder.path)}
                aria-label={`Open folder ${folder.name}`}
                title={folder.name}
                className="flex flex-col items-center justify-center gap-2 aspect-square rounded border border-[var(--border)] bg-[var(--bg-panel)] hover:border-[var(--accent)] transition-colors text-[var(--text-label)]"
              >
                <svg className="w-8 h-8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
                  <path strokeLinejoin="round" d="M1.75 4.25a1 1 0 011-1h3l1.5 1.5h5.5a1 1 0 011 1v6a1 1 0 01-1 1H2.75a1 1 0 01-1-1v-7.5z" />
                </svg>
                <span className="truncate max-w-full px-2 text-xs text-[var(--text-primary)]">{folder.name}</span>
              </button>
            ))}
            {listing.files.map((file) => (
              <GridTile key={file.path} file={file} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
