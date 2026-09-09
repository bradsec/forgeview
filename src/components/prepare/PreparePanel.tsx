import type { RepairStageId } from '../../services/repairStages'
import { useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
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
  const [openSections, setOpenSections] = useState<string[]>([])
  const [activeSection, setActiveSection] = useState('Repair')
  const uid = useId()
  const scaleRef = useRef<HTMLDivElement>(null)
  const fixHandlers: Record<string, () => void> = {
    seal: () => useViewerStore.getState().setRepairDialogOpen(true),
    scale: () => {
      flushSync(() => {
        setOpenSections((sections) => sections.includes('Scale') ? sections : [...sections, 'Scale'])
        setActiveSection('Scale')
      })
      scaleRef.current?.scrollIntoView({ block: 'center' })
      scaleRef.current?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)')?.focus({ preventScroll: true })
    },
  }

  const tool = (label: string, children: React.ReactNode) => {
    const open = openSections.includes(label)
    const id = `${uid}-${label.replace(/[^a-z]/gi, '-')}`
    return (
      <section className="prepare-tool" data-active={activeSection === label} onFocusCapture={() => setActiveSection(label)}>
        <h3><button type="button" aria-expanded={open} aria-controls={id} onClick={() => {
          setOpenSections((sections) => open ? sections.filter((section) => section !== label) : [...sections, label])
          setActiveSection(label)
        }} className="prepare-disclosure"><span>{label}</span><span aria-hidden="true">{open ? '−' : '+'}</span></button></h3>
        <div id={id} hidden={!open} className="prepare-tool-body">{children}</div>
      </section>
    )
  }

  return (
    <div className="prepare-panel flex flex-col gap-6">
      {details ? (
        <ReadinessCard
          checks={prepChecks(details, sealApplied, buildVolumeMm)}
          onFix={(fixId, checkId) => {
            if (fixId === 'seal') {
              const stages: Record<string, RepairStageId | 'seal'> = { watertight: 'seal', nonManifold: 'seal', boundary: 'holeFill', degenerate: 'degenerate', duplicate: 'duplicate' }
              useViewerStore.getState().setRepairStageFocus(stages[checkId ?? ''] ?? 'seal')
            }
            fixHandlers[fixId]?.()
          }}
          canFix={(id) => Object.hasOwn(fixHandlers, id)}
        />
      ) : (
        <p data-testid="prepare-empty" className="text-sm text-[var(--text-muted)]">
          Open a model to run checks.
        </p>
      )}
      <div className="prepare-tool" data-active={activeSection === 'Repair'} onFocusCapture={() => setActiveSection('Repair')}><RepairSection onUndoEdit={onUndoEdit} /></div>
      {tool('Split', <PartsSection viewerRef={viewerRef} />)}
      {tool('Measure', <MeasureSection viewerRef={viewerRef} />)}
      {tool('Scale', <ScaleSection viewerRef={viewerRef} sectionRef={scaleRef} />)}
      {tool('Transform', <TransformSection viewerRef={viewerRef} />)}
      {tool('Analysis', <AnalysisSection />)}
      {tool('Solid operations', <SolidToolsSection viewerRef={viewerRef} />)}
      {tool('Decimate / remesh', <RemeshSection onRemesh={details ? (options, signal) => {
        if (!viewerRef.current) return Promise.reject(new Error('Open a 3D view first'))
        return viewerRef.current.remeshModel(options, signal)
      } : undefined} />)}
    </div>
  )
}
