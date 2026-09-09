import { useEffect, useRef, useState } from 'react'
import type { Viewer3DHandle, RepairRunResult } from './Viewer3D'
import { useViewerStore } from '../store/viewerStore'
import { REPAIR_STAGE_IDS, STAGE_LABEL, type RepairStageId } from '../services/repairStages'
import '../styles/repair-dialog.css'
import type { MeshHealth } from '../services/meshHealth'

/** Internal-wall removal needs the GPU visibility pass to tell walls from deep
 * recesses; without WebGL2 the option is offered but has no effect. */
function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

const ROW_IDS: (RepairStageId | 'seal')[] = [...REPAIR_STAGE_IDS, 'seal']

const SEAL_DESCRIPTION =
  'Fills the model into one sealed solid: interior geometry is removed, touching parts join under one skin, materials collapse to one.'

/** Per-stage `before -> after` line for the fields a stage actually changes,
 * aggregated across every repaired mesh. Empty string when the stage did not
 * run, so the caller can fall back to the live hint. */
function runResultLine(id: RepairStageId | 'seal', res: RepairRunResult): string {
  if (id === 'seal') {
    if (!res.seal) return ''
    const b = res.seal.before
    const a = res.seal.after
    const status = a.watertight
      ? 'Watertight solid'
      : `${a.boundaryEdges} open edge${a.boundaryEdges === 1 ? '' : 's'} left`
    return `${status} — triangles: ${b.triangles} → ${a.triangles}, boundary: ${b.boundaryEdges} → ${a.boundaryEdges}`
  }
  const rows = res.perMesh.flatMap((stages) => stages.filter((s) => s.id === id))
  if (rows.length === 0) return ''
  const notes = rows.map((r) => r.note).filter((n): n is string => Boolean(n)).join('; ')
  const before = (pick: (h: MeshHealth) => number) => rows.reduce((n, r) => n + pick(r.before), 0)
  const after = (pick: (h: MeshHealth) => number) => rows.reduce((n, r) => n + pick(r.after), 0)
  const delta = (label: string, pick: (h: MeshHealth) => number) =>
    `${label}: ${before(pick)} → ${after(pick)}`
  const withNotes = (main: string) => (notes ? `${main} (${notes})` : main)
  switch (id) {
    case 'weld':
      return withNotes(delta('vertices', (h) => h.vertices))
    case 'degenerate':
      return withNotes(delta('degenerate faces', (h) => h.degenerateFaces))
    case 'duplicate':
      return withNotes(delta('duplicate faces', (h) => h.duplicateFaces))
    case 'smallShells':
      return withNotes(delta('triangles', (h) => h.triangles))
    case 'holeFill':
      return withNotes(delta('open edges', (h) => h.boundaryEdges))
    case 'normals':
      return notes
    default:
      return notes
  }
}

export function RepairDialog({ viewerRef }: { viewerRef: React.RefObject<Viewer3DHandle | null> }) {
  const open = useViewerStore((s) => s.repairDialogOpen)
  const details = useViewerStore((s) => s.geometryDetails)
  const hasModel = useViewerStore((s) => s.filePath !== null || s.loadedModels.length > 0)
  const [busy, setBusy] = useState(false)
  const [activeStage, setActiveStage] = useState<RepairStageId | 'seal' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const dialogRef = useRef<HTMLElement>(null)
  const [phase, setPhase] = useState('')
  const [resolution, setResolution] = useState(128)
  const [stripWalls, setStripWalls] = useState(false)
  // Only the most recent run's per-stage lines; stages it did not touch fall
  // back to their live hint. `result` also clears whenever geometryDetails
  // changes from anything other than the run that produced it (an undo made
  // from the panel, say) — `justRanRef` swallows exactly the one change the
  // run itself causes.
  const [result, setResult] = useState<RepairRunResult | null>(null)
  const [stripRequested, setStripRequested] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const justRanRef = useRef(false)
  const [webgl2] = useState(hasWebGL2)

  useEffect(() => {
    if (open) return
    controllerRef.current?.abort()
    setBusy(false)
    setActiveStage(null)
    setPhase('')
    setResult(null)
    setError(null)
    setElapsed(0)
    setResolution(128)
    setStripWalls(false)
    setStripRequested(false)
  }, [open])

  useEffect(() => {
    if (justRanRef.current) { justRanRef.current = false; return }
    setResult(null)
  }, [details])

  const showResult = result !== null

  const close = () => {
    if (controllerRef.current) {
      controllerRef.current.abort()
      setPhase('Cancelling repair and restoring geometry…')
      return
    }
    useViewerStore.getState().setRepairDialogOpen(false)
  }

  const run = async (stageIds: (RepairStageId | 'seal')[]) => {
    const viewer = viewerRef.current
    if (!viewer || controllerRef.current) return
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    setActiveStage(null)
    setPhase(`Running ${STAGE_LABEL[stageIds[0]]}`)
    setActiveStage(stageIds[0])
    setResult(null)
    setError(null)
    setElapsed(0)
    setStripRequested(stripWalls && webgl2)
    useViewerStore.getState().setError(null)
    try {
      const res = await viewer.runRepair(
        stageIds,
        { resolution, stripInternalWalls: stripWalls && webgl2 },
        (percent, nextPhase) => {
          if (controller.signal.aborted) return
          setPhase(nextPhase)
          const reported = stageIds.findIndex((id) => nextPhase.endsWith(`: ${STAGE_LABEL[id]}`))
          if (reported >= 0) setActiveStage(stageIds[reported])
          if (stageIds.includes('seal') && (stageIds.length === 1 || percent >= 50)) setActiveStage('seal')
        },
        controller.signal,
      )
      if (controller.signal.aborted) {
        setPhase('Repair cancellation settled.')
        return
      }
      setPhase('Repair finished. Review the stage results and remaining issues.')
      justRanRef.current = true
      setResult(res)
      useViewerStore.getState().setNotice('Repair applied. Export will use the updated geometry.')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setPhase('Repair cancelled. Previous geometry restored.')
      } else {
        setError(error instanceof Error ? error.message : String(error))
        setPhase('Repair failed.')
      }
    } finally {
      setBusy(false)
      setActiveStage(null)
      controllerRef.current = null
    }
  }

  useEffect(() => {
    if (!busy) return
    dialogRef.current?.querySelector<HTMLElement>('.repair-actions button')?.focus()
    const start = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [busy])

  useEffect(() => {
    if (!open) return
    const trigger = document.activeElement as HTMLElement | null
    const target = useViewerStore.getState().repairStageFocus
    const row = target ? dialogRef.current?.querySelector<HTMLElement>(`[data-testid="repair-stage-${target}"]`) : null
    if (row) {
      row.querySelector<HTMLElement>('button')?.focus()
      row.querySelector<HTMLElement>('button')?.scrollIntoView?.({ block: 'nearest' })
      useViewerStore.getState().setRepairStageFocus(null)
    } else dialogRef.current?.querySelector<HTMLElement>('#repair-title')?.focus()
    return () => {
      if (trigger?.isConnected && !trigger.closest('[inert]')) trigger.focus()
      else requestAnimationFrame(() => trigger?.isConnected && trigger.focus())
    }
  }, [open])

  if (!open) return null

  const hint = (id: RepairStageId | 'seal'): string => {
    if (!details) return ''
    switch (id) {
      case 'degenerate':
        return `${details.degenerateFaces} degenerate faces`
      case 'duplicate':
        return `${details.duplicateFaces} duplicate faces`
      case 'smallShells':
        return `${details.meshes} mesh${details.meshes === 1 ? '' : 'es'}`
      case 'holeFill':
        return `${details.boundaryEdges} open edges`
      case 'seal':
        return details.watertight ? 'Watertight' : 'Not sealed'
      default:
        return ''
    }
  }

  const sealWebglWarning =
    showResult && result?.seal && !result.seal.gpuAssisted
      ? 'WebGL was unavailable, so only the voxel scan ran. Recessed surfaces behind narrow gaps may have been trimmed. Enable hardware acceleration and undo, then re-apply, if the result has holes.'
      : ''
  const stripSkippedWarning =
    showResult && stripRequested && result?.seal && result.seal.strippedWalls === false
      ? 'Internal-wall removal was skipped because WebGL was unavailable.'
      : ''
  const skippedNote =
    showResult && result && result.skippedMeshes > 0
      ? `${result.skippedMeshes} mesh${result.skippedMeshes === 1 ? '' : 'es'} skipped: textured or multi-material geometry is not repaired yet.`
      : ''

  return (
    <div className="repair-overlay">
      <section ref={dialogRef} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
        if (event.key !== 'Tab') return
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button, select, input, [tabindex="0"]') ?? []).filter((control) => !control.hasAttribute('disabled'))
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first?.focus() }
      }} role="dialog" aria-modal="true" aria-labelledby="repair-title" data-busy={busy} className="repair-dialog">
        <div className="repair-header">
          <h2 tabIndex={-1} id="repair-title" className="text-base font-semibold text-[var(--text-bright)]">Repair</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Run individual repair stages or the whole pipeline. Each stage updates the model in place; use the undo history to step back.</p>
        </div>
        <div className="repair-body">
          {ROW_IDS.map((id) => {
            const line = (showResult && result ? runResultLine(id, result) : '') || hint(id)
            return (
              <div key={id} data-testid={`repair-stage-${id}`} aria-current={activeStage === id ? 'step' : undefined} className={`repair-stage ${id === 'seal' ? 'repair-seal' : ''}`}>
                <div className="repair-stage-summary">
                  <span className="flex flex-col">
                    <span className="text-[var(--text-primary)]">{STAGE_LABEL[id]}</span>
                    {busy && activeStage === id && <span className="repair-active-label">Running</span>}
                    {line && <span className="text-xs text-[var(--text-muted)]">{line}</span>}
                  </span>
                  <button type="button" disabled={busy || !hasModel} onClick={() => void run([id])} className="px-3 py-1 rounded bg-[var(--bg-button)] text-xs disabled:opacity-50">Run</button>
                </div>
                {id === 'seal' && (
                  <div className="repair-seal-settings">
                    <p className="text-xs text-[var(--text-muted)]">{SEAL_DESCRIPTION}</p>
                    <label className="text-xs">Interior detection detail
                      <select disabled={busy} value={resolution} onChange={(event) => setResolution(Number(event.target.value))} className="block w-full mt-1 rounded border border-[var(--border-input)] bg-[var(--bg-button)] px-2 py-1">
                        <option value={96}>Draft, faster</option>
                        <option value={128}>Standard</option>
                        <option value={160}>Fine, more memory</option>
                      </select>
                    </label>
                    <label className="flex items-start gap-2 text-xs">
                      <input type="checkbox" className="mt-0.5" checked={stripWalls && webgl2} disabled={busy || !webgl2} onChange={(event) => setStripWalls(event.target.checked)} />
                      <span>
                        Remove internal walls
                        {!webgl2 && <span className="block text-[var(--text-muted)]">Needs WebGL, which is unavailable here.</span>}
                      </span>
                    </label>
                  </div>
                )}
              </div>
            )
          })}
          {(skippedNote || sealWebglWarning || stripSkippedWarning) && (
            <div className="repair-notes flex flex-col gap-1 text-xs text-[var(--text-muted)]">
              {skippedNote && <p>{skippedNote}</p>}
              {sealWebglWarning && <p>{sealWebglWarning}</p>}
              {stripSkippedWarning && <p>{stripSkippedWarning}</p>}
            </div>
          )}
        </div>
        <div className="repair-footer">
          {(busy || phase) && <div className="repair-status">
            <p role="status">{phase}</p>
            <span className="tabular-nums">Elapsed: {elapsed}s</span>
            {busy && <progress aria-label="Repair progress" />}
          </div>}
          {error && <p role="alert" className="text-[var(--error)]">{error}</p>}
          {!hasModel && <p>Open a model to run repairs.</p>}
          <div className="repair-actions">
          <button type="button" onClick={close} className="px-4 py-1.5 rounded bg-[var(--bg-button)]">{busy ? 'Cancel' : 'Close'}</button>
          <button type="button" disabled={busy || !hasModel} onClick={() => void run(ROW_IDS)} className="px-4 py-1.5 rounded bg-[var(--accent-button)] text-white disabled:opacity-50">Repair all</button>
          </div>
        </div>
      </section>
    </div>
  )
}
