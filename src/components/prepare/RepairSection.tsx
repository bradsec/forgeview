import { useViewerStore } from '../../store/viewerStore'

export function RepairSection({ onUndoEdit }: { onUndoEdit?: (steps?: number) => void }) {
  const canUndoEdit = useViewerStore((s) => s.canUndoEdit)
  const undoLabels = useViewerStore((s) => s.undoLabels)
  const hasModel = useViewerStore((s) => s.filePath !== null || s.loadedModels.length > 0)
  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--text-label)] uppercase tracking-wide">
        Repair
      </h3>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        Fill the model into one sealed solid: interior geometry is removed, touching
        parts join under one skin, open edges on the outer surface are closed.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <button
          type="button"
          disabled={!hasModel}
          onClick={() => useViewerStore.getState().setSolidEditorOpen(true)}
          className="px-3 py-1.5 rounded bg-[var(--accent-button)] text-white text-sm self-start disabled:opacity-50"
        >
          Make solid…
        </button>
        <button
          type="button"
          disabled={!canUndoEdit}
          onClick={() => onUndoEdit?.(1)}
          className="px-3 py-1.5 rounded bg-[var(--bg-button)] text-sm self-start disabled:opacity-50"
        >
          Undo last model edit
        </button>
      </div>
      {undoLabels.length > 0 && (
        <ol data-testid="undo-history" className="mt-3 flex flex-col gap-1">
          {undoLabels.map((label, index) => (
            <li key={`${index}-${label}`}>
              <button
                type="button"
                onClick={() => onUndoEdit?.(index + 1)}
                aria-label={`Undo ${index + 1} step${index === 0 ? '' : 's'}: ${label}`}
                className="w-full text-left px-2 py-1 rounded text-xs text-[var(--text-primary)] hover:bg-[var(--bg-button)]"
              >
                {label}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
