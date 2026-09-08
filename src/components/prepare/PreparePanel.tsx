import { useRef } from 'react'
import { useViewerStore } from '../../store/viewerStore'
import { prepChecks } from '../../services/prepChecks'
import { ReadinessCard } from './ReadinessCard'
import { RepairSection } from './RepairSection'
import { PartsSection } from './PartsSection'
import { MeasureSection } from './MeasureSection'
import { ScaleSection } from './ScaleSection'
import { TransformSection } from './TransformSection'
import { AnalysisSection } from './AnalysisSection'
import { SolidToolsSection } from './SolidToolsSection'
import { RemeshSection } from './RemeshSection'
import type { Viewer3DHandle } from '../Viewer3D'

export function PreparePanel({
  onUndoEdit,
  viewerRef,
}: {
  onUndoEdit?: (steps?: number) => void
  viewerRef: React.RefObject<Viewer3DHandle | null>
}) {
  const details = useViewerStore((s) => s.geometryDetails)
  const sealApplied = useViewerStore((s) => s.sealApplied)
  const buildVolumeMm = useViewerStore((s) => s.buildVolumeMm)
  const scaleRef = useRef<HTMLDivElement>(null)
  const fixHandlers: Record<string, () => void> = {
    seal: () => useViewerStore.getState().setRepairDialogOpen(true),
    scale: () => scaleRef.current?.scrollIntoView({ block: 'center' }),
  }

  return (
    <div className="flex flex-col gap-6">
      {details ? (
        <ReadinessCard
          checks={prepChecks(details, sealApplied, buildVolumeMm)}
          onFix={(fixId) => fixHandlers[fixId]?.()}
          canFix={(id) => Object.hasOwn(fixHandlers, id)}
        />
      ) : (
        <p data-testid="prepare-empty" className="text-sm text-[var(--text-muted)]">
          Open a model to run checks.
        </p>
      )}
      <RepairSection onUndoEdit={onUndoEdit} />
      <PartsSection viewerRef={viewerRef} />
      <MeasureSection viewerRef={viewerRef} />
      <ScaleSection viewerRef={viewerRef} sectionRef={scaleRef} />
      <TransformSection viewerRef={viewerRef} />
      <AnalysisSection />
      <SolidToolsSection viewerRef={viewerRef} />
      <RemeshSection onRemesh={details ? (options, signal) => {
        if (!viewerRef.current) return Promise.reject(new Error('Open a 3D view first'))
        return viewerRef.current.remeshModel(options, signal)
      } : undefined} />
    </div>
  )
}
