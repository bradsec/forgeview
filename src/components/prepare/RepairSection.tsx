import { useViewerStore } from '../../store/viewerStore'

export function RepairSection({ onUndoEdit }: { onUndoEdit?: () => void }) {
  const canUndoEdit = useViewerStore((s) => s.canUndoEdit)
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
          onClick={() => useViewerStore.getState().setSolidEditorOpen(true)}
          className="px-3 py-1.5 rounded bg-[var(--accent-button)] text-white text-sm self-start"
        >
          Make solid…
        </button>
        <button
          type="button"
          disabled={!canUndoEdit}
          onClick={() => onUndoEdit?.()}
          className="px-3 py-1.5 rounded bg-[var(--bg-button)] text-sm self-start disabled:opacity-50"
        >
          Undo last model edit
        </button>
      </div>
    </div>
  )
}
