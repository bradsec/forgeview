import { useEffect, useState } from 'react'
import type { Viewer3DHandle } from './Viewer3D'
import { useViewerStore, type MeasurementUnit } from '../store/viewerStore'

const UNIT_SCALE: Record<MeasurementUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 }
const LABELS: Record<MeasurementUnit, string> = { mm: 'Millimetres', cm: 'Centimetres', m: 'Metres', in: 'Inches' }
type Axis = 'width' | 'height' | 'depth'

export function ResizeDialog({ viewerRef }: { viewerRef: React.RefObject<Viewer3DHandle | null> }) {
  const open = useViewerStore((state) => state.resizeOpen)
  const unit = useViewerStore((state) => state.measurementUnit)
  const [dimensions, setDimensions] = useState<Record<Axis, number>>({ width: 0, height: 0, depth: 0 })
  const [original, setOriginal] = useState(dimensions)
  const [preserve, setPreserve] = useState(true)

  useEffect(() => {
    if (!open) return
    const size = viewerRef.current?.getModelDimensions()
    if (!size) return
    const scale = UNIT_SCALE[unit]
    const next = { width: size.x / scale, height: size.y / scale, depth: size.z / scale }
    setDimensions(next)
    setOriginal(next)
  }, [open, viewerRef])

  if (!open) return null
  const setAxis = (axis: Axis, value: number) => {
    if (!preserve || !Number.isFinite(value) || original[axis] <= 0) {
      setDimensions((current) => ({ ...current, [axis]: value }))
      return
    }
    const ratio = value / original[axis]
    setDimensions({ width: original.width * ratio, height: original.height * ratio, depth: original.depth * ratio })
  }
  const changeUnit = (next: MeasurementUnit) => {
    const factor = UNIT_SCALE[unit] / UNIT_SCALE[next]
    setDimensions((current) => ({ width: current.width * factor, height: current.height * factor, depth: current.depth * factor }))
    setOriginal((current) => ({ width: current.width * factor, height: current.height * factor, depth: current.depth * factor }))
    useViewerStore.getState().setMeasurementUnit(next)
  }
  const apply = () => {
    try {
      const scale = UNIT_SCALE[unit]
      viewerRef.current?.resizeModel(dimensions.width * scale, dimensions.height * scale, dimensions.depth * scale)
      useViewerStore.getState().setNotice(`Model resized to ${dimensions.width.toFixed(2)} × ${dimensions.height.toFixed(2)} × ${dimensions.depth.toFixed(2)} ${unit}`)
      useViewerStore.getState().setResizeOpen(false)
    } catch (error) {
      useViewerStore.getState().setError(error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--scrim)]">
      <section role="dialog" aria-modal="true" aria-labelledby="resize-title" className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] shadow-xl">
        <div className="p-5 border-b border-[var(--border)]"><h2 id="resize-title" className="font-semibold text-[var(--text-bright)]">Resize model</h2></div>
        <div className="p-5 flex flex-col gap-4">
          <label className="text-sm">Units<select aria-label="Units" value={unit} onChange={(event) => changeUnit(event.target.value as MeasurementUnit)} className="block w-full mt-1 rounded border border-[var(--border-input)] bg-[var(--bg-button)] px-2 py-1.5">{Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <div className="grid grid-cols-3 gap-3">
            {(['width', 'height', 'depth'] as Axis[]).map((axis) => <label key={axis} className="text-sm capitalize">{axis}<input type="number" min="0" step="any" value={Number.isFinite(dimensions[axis]) ? dimensions[axis] : ''} onChange={(event) => setAxis(axis, event.target.valueAsNumber)} className="block w-full mt-1 rounded border border-[var(--border-input)] bg-[var(--bg-button)] px-2 py-1.5" /></label>)}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={preserve} onChange={(event) => setPreserve(event.target.checked)} />Preserve proportions</label>
        </div>
        <div className="p-4 border-t border-[var(--border)] flex justify-end gap-2"><button type="button" onClick={() => useViewerStore.getState().setResizeOpen(false)} className="px-4 py-1.5 rounded bg-[var(--bg-button)]">Cancel</button><button type="button" onClick={apply} className="px-4 py-1.5 rounded bg-[var(--accent-button)] text-white">Apply</button></div>
      </section>
    </div>
  )
}
