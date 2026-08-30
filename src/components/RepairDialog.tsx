import { useEffect, useRef, useState } from 'react'
import type { Viewer3DHandle } from './Viewer3D'
import { useViewerStore } from '../store/viewerStore'
import { REPAIR_STAGE_IDS, STAGE_LABEL, type RepairStageId } from '../services/repairStages'

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

export function RepairDialog({ viewerRef }: { viewerRef: React.RefObject<Viewer3DHandle | null> }) {
  const open = useViewerStore((s) => s.repairDialogOpen)
  const details = useViewerStore((s) => s.geometryDetails)
  const hasModel = useViewerStore((s) => s.filePath !== null || s.loadedModels.length > 0)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState('')
  const [resolution, setResolution] = useState(128)
  const [stripWalls, setStripWalls] = useState(false)
  const [runNote, setRunNote] = useState<Record<string, string>>({})
  const controllerRef = useRef<AbortController | null>(null)
  const webgl2 = hasWebGL2()

  useEffect(() => {
    if (open) return
    controllerRef.current?.abort()
    setBusy(false)
    setProgress(0)
    setPhase('')
    setRunNote({})
    setStripWalls(false)
  }, [open])

  if (!open) return null

  const close = () => {
    if (busy) controllerRef.current?.abort()
    useViewerStore.getState().setRepairDialogOpen(false)
  }

  const run = async (stageIds: (RepairStageId | 'seal')[]) => {
    const viewer = viewerRef.current
    if (!viewer) return
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    setProgress(0)
    setPhase('')
    useViewerStore.getState().setError(null)
    try {
      const res = await viewer.runRepair(
        stageIds,
        { resolution, stripInternalWalls: stripWalls && webgl2 },
        (percent, nextPhase) => {
          setProgress(percent)
          setPhase(nextPhase)
        },
        controller.signal,
      )
      const notes: Record<string, string> = {}
      res.perMesh.flat().forEach((stage) => {
        if (stage.note) notes[stage.id] = stage.note
      })
      if (res.seal) {
        notes.seal = res.seal.after.watertight
          ? 'Watertight solid'
          : `${res.seal.after.boundaryEdges} open edge${res.seal.after.boundaryEdges === 1 ? '' : 's'} left`
      }
      setRunNote((prev) => ({ ...prev, ...notes }))
      useViewerStore.getState().setNotice('Repair applied. Export will use the updated geometry.')
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        useViewerStore.getState().setError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setBusy(false)
      controllerRef.current = null
    }
  }

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--scrim)]">
      <section role="dialog" aria-modal="true" aria-labelledby="repair-title" className="w-full max-w-lg rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] shadow-xl">
        <div className="p-5 border-b border-[var(--border)]">
          <h2 id="repair-title" className="text-base font-semibold text-[var(--text-bright)]">Repair</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Run individual repair stages or the whole pipeline. Each stage updates the model in place; use the undo history to step back.</p>
        </div>
        <div className="p-5 flex flex-col gap-3">
          {ROW_IDS.map((id) => (
            <div key={id} data-testid={`repair-stage-${id}`} className="flex flex-col gap-1 border-b border-[var(--border)] pb-2 last:border-0 last:pb-0">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex flex-col">
                  <span className="text-[var(--text-primary)]">{STAGE_LABEL[id]}</span>
                  <span className="text-xs text-[var(--text-muted)]">{runNote[id] ?? hint(id)}</span>
                </span>
                <button type="button" disabled={busy || !hasModel} onClick={() => void run([id])} className="px-3 py-1 rounded bg-[var(--bg-button)] text-xs disabled:opacity-50">Run</button>
              </div>
              {id === 'seal' && (
                <div className="flex flex-col gap-2 mt-1">
                  <label className="text-xs">Interior detection detail
                    <select value={resolution} onChange={(event) => setResolution(Number(event.target.value))} className="block w-full mt-1 rounded border border-[var(--border-input)] bg-[var(--bg-button)] px-2 py-1">
                      <option value={96}>Draft, faster</option>
                      <option value={128}>Standard</option>
                      <option value={160}>Fine, more memory</option>
                    </select>
                  </label>
                  <label className="flex items-start gap-2 text-xs">
                    <input type="checkbox" className="mt-0.5" checked={stripWalls && webgl2} disabled={!webgl2} onChange={(event) => setStripWalls(event.target.checked)} />
                    <span>
                      Remove internal walls
                      {!webgl2 && <span className="block text-[var(--text-muted)]">Needs WebGL, which is unavailable here.</span>}
                    </span>
                  </label>
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div>
              <div className="flex justify-between text-sm"><span>{phase}</span><span className="tabular-nums">{progress}%</span></div>
              <progress className="w-full mt-1" value={progress} max={100}>{progress}%</progress>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-[var(--border)] flex justify-end gap-2">
          <button type="button" onClick={close} className="px-4 py-1.5 rounded bg-[var(--bg-button)]">{busy ? 'Cancel' : 'Close'}</button>
          <button type="button" disabled={busy || !hasModel} onClick={() => void run(ROW_IDS)} className="px-4 py-1.5 rounded bg-[var(--accent-button)] text-white disabled:opacity-50">Repair all</button>
        </div>
      </section>
    </div>
  )
}
