import { useEffect, useRef, useState } from 'react'
import { useViewerStore } from '../../store/viewerStore'
import type { Viewer3DHandle } from '../Viewer3D'
import type { BooleanOperation } from '../../services/booleanMesh'

export function SolidToolsSection({ viewerRef }: { viewerRef: React.RefObject<Viewer3DHandle | null> }) {
  const details = useViewerStore(s => s.geometryDetails)
  const clip = useViewerStore(s => s.clipMode)
  const models = useViewerStore(s => s.loadedModels)
  const parts = useViewerStore(s => s.splitParts)
  const pending = useViewerStore(s => s.pendingModelLoads)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [operation, setOperation] = useState<BooleanOperation>('union')
  const [thickness, setThickness] = useState(2)
  const [resolution, setResolution] = useState(32)
  const [radius, setRadius] = useState(0)
  const [axis, setAxis] = useState<'x' | 'y' | 'z'>('y')
  const [offset, setOffset] = useState<[number, number, number]>([0, 0, 0])
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const disabled = busy || !details || pending > 0 || parts.length > 0
  const validHollow = Number.isFinite(thickness) && thickness > 0 && Number.isFinite(radius) && radius >= 0 &&
    Number.isInteger(resolution) && resolution >= 16 && resolution <= 64 && offset.every(Number.isFinite)
  const run = async (label: string, action: (viewer: Viewer3DHandle, signal: AbortSignal) => Promise<void>) => {
    if (!viewerRef.current || busy) return
    const active = new AbortController()
    controller.current = active
    setBusy(true)
    setMessage(`${label} in progress`)
    try {
      await action(viewerRef.current, active.signal)
      if (!active.signal.aborted) setMessage(`${label} complete. Undo restores the original.`)
    } catch (error) {
      setMessage(active.signal.aborted ? 'Cancelled' : error instanceof Error ? error.message : `${label} failed`)
    } finally { setBusy(false); controller.current = null }
  }
  const button = 'mt-2 px-3 py-1.5 rounded bg-[var(--accent-button)] text-white text-sm disabled:opacity-50'
  const input = 'ml-2 w-20 rounded bg-[var(--bg-button)] p-1'
  return <section aria-label="Solid operations" className="flex flex-col gap-3">
    <h3 className="text-sm font-semibold text-[var(--text-label)] uppercase tracking-wide">Solid operations</h3>
    <p className="text-xs text-[var(--text-muted)]">Closed, static, untextured meshes only. Run Repair first for open surfaces. Each operation is undoable.</p>
    <div>
      <p className="text-xs">Show and position the clip plane in Analysis, then cut into two capped parts.</p>
      <button className={button} disabled={disabled || !clip || models.length > 0} onClick={() => void run('Plane cut', (v, signal) => v.cutAtPlane(signal))}>Cut at plane</button>
    </div>
    <fieldset disabled={disabled || models.length < 2} className="text-xs">
      <legend className="font-semibold">Boolean between scene models</legend>
      <p className="mt-1 text-[var(--text-muted)]">Add two models to the scene from the folder grid. Subtract removes B from A. The result replaces A and consumes B geometry; Undo restores both.</p>
      {(['A', 'B'] as const).map(label => <label key={label} className="mt-2 block">Model {label}
        <select className={input + ' w-full ml-0 mt-1'} value={label === 'A' ? a : b} onChange={e => label === 'A' ? setA(e.target.value) : setB(e.target.value)}>
          <option value="">Choose model</option>
          {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      </label>)}
      <label className="mt-2 block">Boolean operation
        <select className={input + ' w-auto'} value={operation} onChange={e => setOperation(e.target.value as BooleanOperation)}>
          <option value="union">Union</option><option value="subtract">Subtract A minus B</option><option value="intersection">Intersection</option>
        </select>
      </label>
      <button className={button} disabled={!a || !b || a === b} onClick={() => void run('Boolean', (v, signal) => v.booleanOperation(a, b, operation, signal))}>Apply boolean</button>
    </fieldset>
    <fieldset disabled={disabled} className="text-xs">
      <legend className="font-semibold">Hollow and drain</legend>
      {details && !details.modelUnitInMm && <p className="mt-1">Assign import units in the Details tab before hollowing.</p>}
      <p className="mt-1 text-[var(--text-muted)]">One mesh. Inner surface is approximate; walls must be at least one grid cell thick. The optional straight drain passes through the model on the chosen axis.</p>
      <label className="mt-2 block">Wall thickness (mm)<input className={input} type="number" min={0.01} step={0.1} value={thickness} onChange={e => setThickness(Number(e.target.value))} /></label>
      <label className="mt-2 block">Hollow resolution<input className={input} type="number" min={16} max={64} value={resolution} onChange={e => setResolution(Number(e.target.value))} /></label>
      <label className="mt-2 block">Drain radius (mm)<input className={input} type="number" min={0} step={0.1} value={radius} onChange={e => setRadius(Number(e.target.value))} /></label>
      <p className="mt-1 text-[var(--text-muted)]">Radius 0 leaves the cavity sealed.</p>
      {radius > 0 && <>
        <label className="mt-2 block">Drain axis<select className={input} value={axis} onChange={e => setAxis(e.target.value as typeof axis)}>{['x', 'y', 'z'].map(a => <option key={a}>{a}</option>)}</select></label>
        <p className="mt-2 text-[var(--text-muted)]">Drain center in scene coordinates (mm).</p>
        {['X', 'Y', 'Z'].map((label, index) => <label key={label} className="mt-1 block">Drain {label}<input className={input} type="number" value={offset[index]} onChange={e => setOffset(previous => previous.map((v, i) => i === index ? Number(e.target.value) : v) as typeof offset)} /></label>)}
      </>}
      <button className={button} disabled={!validHollow || !details?.modelUnitInMm} onClick={() => void run('Hollow', (v, signal) => v.hollowModel({wallThickness: thickness, resolution, drainRadius: radius, drainAxis: axis, drainOffset: offset}, signal))}>Hollow model</button>
    </fieldset>
    {busy && <button type="button" className="text-sm underline" onClick={() => controller.current?.abort()}>Cancel solid operation</button>}
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>
}
