import { useEffect, useRef, useState } from 'react'
import { MAX_REMESH_TRIANGLES, remeshInputError } from '../../services/remeshLimits'
import type { RemeshOptions } from '../../services/remesh'

export interface RemeshSectionProps {
  triangleCount?: number | null
  onRemesh?: (options: RemeshOptions, signal?: AbortSignal) => Promise<{ beforeTriangles: number; afterTriangles: number }>
}

export function RemeshSection({ onRemesh, triangleCount }: RemeshSectionProps) {
  const [operation, setOperation] = useState<'decimate' | 'remesh'>('decimate')
  const [target, setTarget] = useState(1000)
  const [resolution, setResolution] = useState(32)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const effectiveTarget = triangleCount == null ? target : Math.min(target, triangleCount)
  const inputError = triangleCount == null ? null : remeshInputError(triangleCount)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const run = async () => {
    if (!onRemesh) return
    const active = new AbortController()
    controller.current = active
    setBusy(true)
    setStatus('Processing geometry…')
    try {
      const result = await onRemesh(operation === 'decimate' ? { operation, targetTriangles: effectiveTarget } : { operation, resolution }, active.signal)
      if (!active.signal.aborted) setStatus(`${result.beforeTriangles.toLocaleString()} → ${result.afterTriangles.toLocaleString()} triangles`)
    } catch (error) {
      setStatus(active.signal.aborted ? 'Cancelled' : error instanceof Error ? error.message : 'Remesh failed')
    } finally {
      controller.current = null
      setBusy(false)
    }
  }
  const valid = operation === 'decimate' ? Number.isInteger(effectiveTarget) && effectiveTarget >= 4 : Number.isInteger(resolution) && resolution >= 8 && resolution <= 64
  return <div>
    <h3 className="text-sm font-semibold text-[var(--text-label)] uppercase tracking-wide">Decimate / remesh</h3>
    <label className="mt-2 block text-xs">Operation
      <select className="ml-2 bg-[var(--bg-button)] rounded p-1" value={operation} disabled={busy} onChange={(event) => setOperation(event.target.value as typeof operation)}>
        <option value="decimate">Decimate</option><option value="remesh">Uniform voxel remesh</option>
      </select>
    </label>
    {operation === 'decimate' ? <>
      <label className="mt-2 block text-xs">Target triangles
        <input className="ml-2 w-24 bg-[var(--bg-button)] rounded p-1" type="number" min={4} max={triangleCount ?? undefined} step={1} value={effectiveTarget} disabled={busy} onChange={(event) => setTarget(Number(event.target.value))} />
      </label>
      <p className="mt-2 text-xs text-[var(--text-muted)]">Approximate target using edge collapse. Topology constraints may prevent reaching the target. Small details may disappear.</p>
    </> : <>
      <label className="mt-2 block text-xs">Grid resolution
        <input className="ml-2 w-20 bg-[var(--bg-button)] rounded p-1" type="number" min={8} max={64} step={1} value={resolution} disabled={busy} onChange={(event) => setResolution(Number(event.target.value))} />
      </label>
      <p className="mt-2 text-xs text-[var(--text-muted)]">Rebuilds a closed surface on a uniform voxel grid. Produces stepped surfaces; details smaller than one cell may disappear.</p>
    </>}
    {triangleCount != null && <p className="mt-2 text-xs">Current mesh: {triangleCount.toLocaleString()} triangles. Supports up to {MAX_REMESH_TRIANGLES.toLocaleString()}.</p>}
    {inputError && <p role="alert" className="mt-2 text-xs">{inputError}</p>}
    <p className="mt-2 text-xs text-[var(--text-muted)]">Requires a single static mesh with one untextured material. Undo restores the original geometry.</p>
    <button type="button" disabled={busy || !onRemesh || !valid || !!inputError} onClick={() => void run()} className="mt-3 px-3 py-1.5 rounded bg-[var(--accent-button)] text-white text-sm disabled:opacity-50">Apply remesh</button>
    {busy && <button type="button" className="ml-2 text-sm" onClick={() => controller.current?.abort()}>Cancel remesh</button>}
    {status && <p role="status" className="mt-2 text-xs">{status}</p>}
  </div>
}
