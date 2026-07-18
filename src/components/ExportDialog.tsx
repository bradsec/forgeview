import { useEffect, useRef, useState } from 'react'
import { useViewerStore } from '../store/viewerStore'
import type { Viewer3DHandle } from './Viewer3D'
import { EXPORT_FORMATS, THREE_MF_UNITS } from '../services/exportFormats'
import type { ExportFormat, ThreeMFUnit } from '../services/exportFormats'
import { saveExportedFile } from '../services/saveFile'

interface ExportDialogProps {
  viewerRef: React.RefObject<Viewer3DHandle | null>
}

function exportFileName(sourceName: string | null, format: ExportFormat): string {
  const base = sourceName ? sourceName.replace(/\.[^.]+$/, '') : 'forgeview-export'
  return `${base}${format}`
}

/**
 * In-app export dialog: pick a target format, optionally make the model
 * then save. Browser mode downloads the
 * file directly; the desktop app opens the native save dialog from Rust.
 */
export function ExportDialog({ viewerRef }: ExportDialogProps) {
  const exportOpen = useViewerStore((s) => s.exportOpen)
  const fileName = useViewerStore((s) => s.fileName)
  const pendingModelLoads = useViewerStore((s) => s.pendingModelLoads)
  const [format, setFormat] = useState<ExportFormat>('.stl')
  const [threeMFUnit, setThreeMFUnit] = useState<ThreeMFUnit>('millimeter')
  const [busy, setBusy] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const close = () => {
    if (!busy) useViewerStore.getState().setExportOpen(false)
  }

  useEffect(() => {
    if (!exportOpen) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    closeButtonRef.current?.focus()
    return () => previousFocusRef.current?.focus()
  }, [exportOpen])

  if (!exportOpen) return null

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
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

  const runExport = async () => {
    const scene = viewerRef.current?.getScene()
    const store = useViewerStore.getState()
    if (store.pendingModelLoads > 0) {
      store.setError('Wait for all scene models to finish loading before exporting')
      return
    }
    if (!scene) {
      store.setError('Export needs an open 3D view')
      return
    }
    setBusy(true)
    store.setError(null)
    let meshes: import('three').Mesh[] = []
    try {
      const { collectExportMeshes, exportMeshes } = await import('../services/exporters')
      meshes = collectExportMeshes(scene)
      const bytes = await exportMeshes(meshes, format, { threeMFUnit })
      const target = exportFileName(fileName, format)
      const saved = await saveExportedFile(bytes, target)
      if (saved !== null) {
        store.setNotice(`Exported ${saved}`)
        store.setExportOpen(false)
      }
    } catch (err) {
      store.setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (meshes.length > 0) {
        const { disposeExportMeshes } = await import('../services/exporters')
        disposeExportMeshes(meshes)
      }
      setBusy(false)
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
          aria-labelledby="export-title"
          onKeyDown={handleKeyDown}
          className="bg-[var(--bg-dialog)] border border-[var(--border)] rounded shadow-[0_10px_40px_var(--shadow-color)] w-full max-w-sm"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
            <h2 id="export-title" className="text-base font-semibold text-[var(--text-bright)]">Export model</h2>
            <button
              ref={closeButtonRef}
              onClick={close}
              disabled={busy}
              className="text-[var(--text-label)] hover:text-[var(--text-primary)] text-lg leading-none"
              aria-label="Close export dialog"
            >
              &times;
            </button>
          </div>

          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-[var(--text-label)] uppercase tracking-wide mb-2">Format</p>
            <div role="radiogroup" aria-label="Export format" className="flex flex-col gap-1 mb-4">
              {EXPORT_FORMATS.map((option) => (
                <label
                  key={option.format}
                  className="flex items-center gap-2 py-1 text-sm text-[var(--text-primary)] cursor-pointer"
                >
                  <input
                    type="radio"
                    name="export-format"
                    value={option.format}
                    checked={format === option.format}
                    onChange={() => setFormat(option.format)}
                    className="accent-[var(--accent)]"
                  />
                  {option.label}
                </label>
              ))}
            </div>

            {format === '.3mf' && (
              <label className="block mb-4 text-sm text-[var(--text-primary)]">
                <span className="block text-xs font-semibold text-[var(--text-label)] uppercase tracking-wide mb-1">3MF units</span>
                <select
                  value={threeMFUnit}
                  onChange={(event) => setThreeMFUnit(event.target.value as ThreeMFUnit)}
                  className="w-full rounded border border-[var(--border)] bg-[var(--bg-button)] px-2 py-1.5"
                >
                  {THREE_MF_UNITS.map((option) => (
                    <option key={option.unit} value={option.unit}>{option.label}</option>
                  ))}
                </select>
              </label>
            )}

          </div>

          <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="px-4 py-1.5 text-sm rounded bg-[var(--bg-button)] text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void runExport()}
              disabled={busy || pendingModelLoads > 0}
              className="px-4 py-1.5 bg-[var(--accent-button)] hover:bg-[var(--accent-button-hover)] text-[var(--text-on-accent)] text-sm rounded transition-colors disabled:opacity-60"
            >
              {busy ? 'Exporting…' : pendingModelLoads > 0 ? 'Loading models…' : 'Export'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
