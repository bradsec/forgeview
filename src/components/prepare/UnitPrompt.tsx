import { useState } from 'react'
import { useViewerStore } from '../../store/viewerStore'
import { UNIT_IN_MM } from '../../services/unitConversion'
import type { Viewer3DHandle } from '../Viewer3D'

const CHOICES = [
  { label: 'mm', mm: UNIT_IN_MM.mm },
  { label: 'cm', mm: UNIT_IN_MM.cm },
  { label: 'in', mm: UNIT_IN_MM.in },
]

export function UnitPrompt({
  viewerRef,
}: {
  viewerRef: React.RefObject<Viewer3DHandle | null>
}) {
  const details = useViewerStore((s) => s.geometryDetails)
  const [choice, setChoice] = useState('mm')
  if (!details || details.modelUnitInMm !== null) return null
  const mm = CHOICES.find((c) => c.label === choice)!.mm
  return (
    <div data-testid="unit-prompt" className="mt-6 rounded border border-[var(--bg-button)] p-3">
      <p className="text-xs text-[var(--text-muted)]">Unit not specified, assuming millimetres.</p>
      <div className="mt-2 flex items-center gap-2">
        <select
          aria-label="Import unit"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="bg-[var(--bg-button)] rounded px-2 py-1 text-sm"
        >
          {CHOICES.map((c) => (
            <option key={c.label} value={c.label}>{c.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => viewerRef.current?.setModelUnit(mm)}
          className="px-3 py-1 rounded bg-[var(--accent-button)] text-white text-sm"
        >
          Apply
        </button>
      </div>
    </div>
  )
}
