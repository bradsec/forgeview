import { useEffect, useRef } from 'react'
import { useViewerStore } from '../store/viewerStore'

const HELP_SECTIONS: { title: string; body: string }[] = [
  {
    title: 'Readiness checks',
    body: 'The card at the top of the Prepare panel runs each check against the open model and shows OK, Check, or Fix needed. Rows marked Fix needed have a Fix button that opens the tool that resolves them.',
  },
  {
    title: 'Repair',
    body: 'Fills the model into one sealed solid, or runs individual stages: weld vertices, drop bad faces, unify normals, remove small shells, fill holes. "Fill a single hole" lets you pick one open loop in the viewport.',
  },
  {
    title: 'Split into parts',
    body: 'Separates a multi-body model into individually named, toggleable, separately exportable parts. Undo recombines them.',
  },
  {
    title: 'Measure',
    body: 'Click two points on the model to read the straight-line distance in the current display unit.',
  },
  {
    title: 'Scale',
    body: 'Resize the model so one dimension hits a target length, or so the whole model fits a configured build volume.',
  },
  {
    title: 'Transform',
    body: 'Nudge the model by an offset, angle, or per-axis factor; mirror it; drop it to the floor; or center it on the plate. Each is one undoable step.',
  },
  {
    title: 'Overhang heatmap',
    body: 'Highlights faces that point steeply downward past the overhang angle, the surfaces that would need print supports. The Overhangs readiness row uses the same threshold.',
  },
  {
    title: 'Wall thickness heatmap',
    body: 'Highlights faces whose wall is thinner than the minimum you set (default 1.0 mm), measured by casting a ray straight into the solid from each face. The Thin walls readiness row uses the same minimum. Very large models are skipped for speed.',
  },
  {
    title: 'X-ray and clip plane',
    body: 'X-ray makes the model translucent so you can see interior walls and trapped voids. The clip plane hides everything on one side of an adjustable X, Y, or Z cut, showing a live cross-section. Use both to check what Make solid or hollow produced. They turn off automatically when a heatmap or hole-fill is armed.',
  },
  {
    title: 'Build volume',
    body: 'Show build volume draws your configured printer volume as a wireframe box on the plate, centred on the origin with its base on the plate. It is a fixed reference and does not move or scale the model. Set the size with the Scale to build volume fields, then use Center on plate and Drop to floor to bring the model onto it. The On build plate readiness row reports whether it fits.',
  },
  {
    title: 'Auto-orient',
    body: 'Auto-orient tries many rest orientations and picks the one with the least downward-facing overhang area, breaking ties by a lower height and more bed contact. It rotates the model, drops it to the floor, and centres it on the plate as one undoable step, then reports the overhang-area change. That percentage is a surface-area fraction and excludes faces resting on the plate, so it is not the same number as the Overhangs readiness count. Very large models are skipped for speed.',
  },
  {
    title: 'Arrange on plate',
    body: 'Arrange on plate lays every model in the scene out in a grid inside the build volume footprint and drops each to the plate, as one undoable step. It only moves models, it does not rotate or scale them. Models too large for the footprint are left where they are and reported.',
  },
]

export function HelpModal() {
  const helpOpen = useViewerStore((s) => s.helpOpen)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const close = () => useViewerStore.getState().setHelpOpen(false)

  useEffect(() => {
    if (!helpOpen) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    closeButtonRef.current?.focus()
    return () => previousFocusRef.current?.focus()
  }, [helpOpen])

  if (!helpOpen) return null

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      )
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-[var(--scrim)] z-40" onClick={close} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
          onKeyDown={handleKeyDown}
          className="bg-[var(--bg-dialog)] border border-[var(--border)] rounded shadow-[0_10px_40px_var(--shadow-color)] w-full max-w-lg max-h-[85vh] flex flex-col"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
            <h2 id="help-title" className="text-base font-semibold text-[var(--text-bright)]">Feature guide</h2>
            <button
              type="button"
              ref={closeButtonRef}
              onClick={close}
              aria-label="Close feature guide"
              className="text-[var(--text-label)] hover:text-[var(--text-primary)] text-lg leading-none"
            >
              &times;
            </button>
          </div>
          <div className="px-5 py-4 overflow-y-auto flex flex-col gap-4">
            {HELP_SECTIONS.map((s) => (
              <section key={s.title}>
                <h3 className="text-sm font-semibold text-[var(--text-bright)]">{s.title}</h3>
                <p className="mt-1 text-sm text-[var(--text-primary)]">{s.body}</p>
              </section>
            ))}
          </div>
          <div className="px-5 py-4 border-t border-[var(--border)] flex justify-end">
            <button
              type="button"
              onClick={close}
              className="px-3 py-1.5 rounded bg-[var(--bg-button)] text-sm"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
