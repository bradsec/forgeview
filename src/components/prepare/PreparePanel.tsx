import { useViewerStore } from '../../store/viewerStore'
import { prepChecks } from '../../services/prepChecks'
import { ReadinessCard } from './ReadinessCard'
import { RepairSection } from './RepairSection'

const FIX_HANDLERS: Record<string, () => void> = {
  seal: () => useViewerStore.getState().setSolidEditorOpen(true),
}

export function PreparePanel({ onUndoEdit }: { onUndoEdit?: () => void }) {
  const details = useViewerStore((s) => s.geometryDetails)

  if (!details) {
    return (
      <p data-testid="prepare-empty" className="text-sm text-[var(--text-muted)]">
        Open a model to run checks.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <ReadinessCard
        checks={prepChecks(details)}
        onFix={(fixId) => FIX_HANDLERS[fixId]?.()}
      />
      <RepairSection onUndoEdit={onUndoEdit} />
    </div>
  )
}
