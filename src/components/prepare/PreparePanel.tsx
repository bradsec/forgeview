import { useViewerStore } from '../../store/viewerStore'
import { prepChecks } from '../../services/prepChecks'
import { ReadinessCard } from './ReadinessCard'
import { RepairSection } from './RepairSection'
import { PartsSection } from './PartsSection'
import type { Viewer3DHandle } from '../Viewer3D'

const FIX_HANDLERS: Record<string, () => void> = {
  seal: () => useViewerStore.getState().setRepairDialogOpen(true),
}

export function PreparePanel({
  onUndoEdit,
  viewerRef,
}: {
  onUndoEdit?: (steps?: number) => void
  viewerRef: React.RefObject<Viewer3DHandle | null>
}) {
  const details = useViewerStore((s) => s.geometryDetails)
  const sealApplied = useViewerStore((s) => s.sealApplied)

  return (
    <div className="flex flex-col gap-6">
      {details ? (
        <ReadinessCard
          checks={prepChecks(details, sealApplied)}
          onFix={(fixId) => FIX_HANDLERS[fixId]?.()}
          canFix={(id) => Object.hasOwn(FIX_HANDLERS, id)}
        />
      ) : (
        <p data-testid="prepare-empty" className="text-sm text-[var(--text-muted)]">
          Open a model to run checks.
        </p>
      )}
      <RepairSection onUndoEdit={onUndoEdit} />
      <PartsSection viewerRef={viewerRef} />
    </div>
  )
}
