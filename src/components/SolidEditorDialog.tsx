import { useEffect, useRef, useState } from 'react'
import type { Viewer3DHandle } from './Viewer3D'
import type { SolidRepairStats } from '../services/solidRepair'
import { useViewerStore } from '../store/viewerStore'

export function SolidEditorDialog({ viewerRef }: { viewerRef: React.RefObject<Viewer3DHandle | null> }) {
  const open = useViewerStore((state) => state.solidEditorOpen)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState('Ready to analyse the model')
  const [stats, setStats] = useState<SolidRepairStats | null>(null)
  const [busy, setBusy] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (open) return
    controllerRef.current?.abort()
    setProgress(0)
    setPhase('Ready to analyse the model')
    setStats(null)
    setBusy(false)
  }, [open])

  if (!open) return null
  const close = () => {
    if (busy) controllerRef.current?.abort()
    useViewerStore.getState().setSolidEditorOpen(false)
  }
  const run = async () => {
    const viewer = viewerRef.current
    if (!viewer) return
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    useViewerStore.getState().setError(null)
    try {
      const result = await viewer.makeSolid((percent, nextPhase) => {
        setProgress(percent)
        setPhase(nextPhase)
      }, controller.signal)
      setStats(result)
      useViewerStore.getState().setNotice('Model repair applied. Export will use the repaired geometry.')
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        useViewerStore.getState().setError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setBusy(false)
      controllerRef.current = null
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--scrim)]">
      <section role="dialog" aria-modal="true" aria-labelledby="solid-editor-title" className="w-full max-w-lg rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] shadow-xl">
        <div className="p-5 border-b border-[var(--border)]">
          <h2 id="solid-editor-title" className="text-base font-semibold text-[var(--text-bright)]">Make solid</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Closes simple planar holes, removes duplicate and degenerate faces, and removes fully enclosed shells. Existing exterior vertices are not moved.</p>
        </div>
        <div className="p-5">
          <div className="flex justify-between text-sm"><span>{phase}</span><span className="tabular-nums">{progress}%</span></div>
          <progress className="w-full mt-2" value={progress} max={100}>{progress}%</progress>
          {stats && (
            <dl className="grid grid-cols-2 gap-x-5 gap-y-2 mt-5 text-sm">
              <div><dt className="text-[var(--text-muted)]">Triangles</dt><dd>{stats.before.triangles.toLocaleString()} → {stats.after.triangles.toLocaleString()}</dd></div>
              <div><dt className="text-[var(--text-muted)]">Vertices</dt><dd>{stats.before.vertices.toLocaleString()} → {stats.after.vertices.toLocaleString()}</dd></div>
              <div><dt className="text-[var(--text-muted)]">Boundary edges</dt><dd>{stats.before.boundaryEdges.toLocaleString()} → {stats.after.boundaryEdges.toLocaleString()}</dd></div>
              <div><dt className="text-[var(--text-muted)]">Non-manifold edges</dt><dd>{stats.before.nonManifoldEdges.toLocaleString()} → {stats.after.nonManifoldEdges.toLocaleString()}</dd></div>
              <div><dt className="text-[var(--text-muted)]">Faces removed</dt><dd>{(stats.before.duplicateFaces + stats.before.degenerateFaces).toLocaleString()}</dd></div>
              <div><dt className="text-[var(--text-muted)]">Enclosed shells removed</dt><dd>{stats.shellsRemoved.toLocaleString()}</dd></div>
              <div><dt className="text-[var(--text-muted)]">Result</dt><dd>{stats.after.watertight ? 'Watertight' : 'Further repair needed'}</dd></div>
            </dl>
          )}
        </div>
        <div className="p-4 border-t border-[var(--border)] flex justify-end gap-2">
          <button type="button" onClick={close} className="px-4 py-1.5 rounded bg-[var(--bg-button)]">{busy ? 'Cancel' : 'Close'}</button>
          {!stats && <button type="button" disabled={busy} onClick={() => void run()} className="px-4 py-1.5 rounded bg-[var(--accent-button)] text-white disabled:opacity-50">{busy ? 'Repairing…' : 'Repair model'}</button>}
        </div>
      </section>
    </div>
  )
}

