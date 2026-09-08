import { useEffect, useState } from 'react'
import { useViewerStore } from '../../store/viewerStore'
import type { Viewer3DHandle } from '../Viewer3D'

export function PartsSection({ viewerRef }: { viewerRef: React.RefObject<Viewer3DHandle | null> }) {
  const splitParts = useViewerStore((s) => s.splitParts)
  const hasModel = useViewerStore((s) => s.filePath !== null)
  const multiModel = useViewerStore((s) => s.loadedModels.length > 0)
  const pending = useViewerStore((s) => s.pendingModelLoads)
  const [note, setNote] = useState<string | null>(null)

  const disabled = !hasModel || multiModel || pending > 0 || splitParts.length > 0

  useEffect(() => { if (splitParts.length === 0) setNote(null) }, [splitParts.length])

  const runSplit = () => {
    try {
      const { droppedFragments } = viewerRef.current!.splitByShell()
      setNote(droppedFragments > 0
        ? `${droppedFragments} tiny fragment${droppedFragments === 1 ? '' : 's'} removed`
        : null)
    } catch (e) {
      useViewerStore.getState().setError(e instanceof Error ? e.message : 'Split failed')
    }
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--text-label)] uppercase tracking-wide">
        Split
      </h3>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        Separate a multi-body model into individually named parts. Tiny fragments
        are dropped. Delete keeps at least one part. Undo restores deleted parts
        or recombines the original model.
      </p>
      <button
        type="button"
        disabled={disabled}
        onClick={runSplit}
        className="mt-3 px-3 py-1.5 rounded bg-[var(--accent-button)] text-white text-sm self-start disabled:opacity-50"
      >
        Split by shell
      </button>
      {note && <p className="mt-2 text-xs text-[var(--text-muted)]">{note}</p>}
      {splitParts.length > 0 && (
        <ul data-testid="split-parts" className="mt-3 flex flex-col gap-1">
          {splitParts.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={p.visible}
                aria-label={`Show ${p.name}`}
                onChange={(e) => useViewerStore.getState().setSplitPartVisible(p.id, e.target.checked)}
              />
              <span className="flex-1 text-[var(--text-primary)]">{p.name}</span>
              <span className="text-[var(--text-muted)]">{p.triangleCount.toLocaleString()} tris</span>
              <button
                type="button"
                onClick={() => {
                  useViewerStore.getState().setExportTargetId(p.id)
                  useViewerStore.getState().setExportOpen(true)
                }}
                className="px-2 py-0.5 rounded bg-[var(--bg-button)]"
              >
                Export
              </button>
              <button
                type="button"
                aria-label={`Delete ${p.name}`}
                disabled={splitParts.length < 2}
                className="px-2 py-0.5 rounded bg-[var(--bg-button)] disabled:opacity-50"
                onClick={() => {
                  try { viewerRef.current?.deleteSplitPart(p.id) }
                  catch (error) { useViewerStore.getState().setError(error instanceof Error ? error.message : 'Delete failed') }
                }}
              >Delete</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
