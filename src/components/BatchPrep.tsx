import { useEffect, useRef, useState } from 'react'
import type { GridFile } from '../services/gridFiles'
import { BATCH_MAX_FILES, prepareBatch, type BatchInputUnit, type BatchProgress, type BatchResult } from '../services/batchPrep'
import { saveExportedFile } from '../services/saveFile'

export function BatchPrep({ files }: { files: GridFile[] }) {
  const [open, setOpen] = useState(false)
  const [unit, setUnit] = useState<BatchInputUnit | ''>('')
  const [progress, setProgress] = useState<BatchProgress | null>(null)
  const [result, setResult] = useState<BatchResult | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => { controller.current?.abort() }, [])

  const run = async () => {
    if (!unit || controller.current) return
    const active = new AbortController()
    controller.current = active
    setResult(null)
    setMessage(null)
    setProgress({ completed: 0, total: files.length, name: 'Starting batch' })
    try {
      const prepared = await prepareBatch(files, unit, active.signal, setProgress)
      if (!active.signal.aborted) setResult(prepared)
    } catch (error) {
      setMessage(active.signal.aborted ? 'Batch cancelled. No output was saved.' : error instanceof Error ? error.message : String(error))
    } finally {
      controller.current = null
      setProgress(null)
    }
  }
  const save = async () => {
    if (!result) return
    setSaving(true)
    try {
      const name = await saveExportedFile(result.bytes, 'forgeview-prepared.zip')
      if (name !== null) setMessage(`Saved ${name}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally { setSaving(false) }
  }
  const buttonClass = 'rounded px-2.5 py-1 text-xs bg-[var(--bg-button)] text-[var(--text-primary)] disabled:opacity-50'
  return (
    <div className="border-b border-[var(--border)] px-4 py-2 text-xs text-[var(--text-primary)]">
      <button type="button" className={buttonClass} disabled={!files.length || !!progress || saving} onClick={() => setOpen(!open)} aria-expanded={open}>
        Batch prepare ({files.length})
      </button>
      {open && <section aria-label="Batch preparation" className="mt-2 flex flex-col gap-2">
        <p>Repair all six stages, remove small shells, fill holes, and auto-orient. Sources stay untouched. Review outputs before printing.</p>
        <p>Limits: 100 files, 32 MiB per source, 200,000 triangles per model, 256 MiB total output. Animated/deformed models and textured or externally referenced glTF/Collada are skipped.</p>
        <label>Unitless input units{' '}
          <select aria-label="Unitless input units" disabled={!!progress || saving} value={unit} onChange={(event) => setUnit(event.target.value as BatchInputUnit)} className="bg-[var(--bg-input)] rounded px-2 py-1">
            <option value="">Choose units</option><option value="mm">Millimeters</option><option value="cm">Centimeters</option><option value="in">Inches</option>
          </select>
        </label>
        <p>3MF, glTF and Collada use their declared units. Output: binary STL in millimeters, Z-up, plus a per-file manifest.</p>
        {files.length > BATCH_MAX_FILES && <p role="alert">Choose a folder with at most {BATCH_MAX_FILES} files.</p>}
        <div className="flex gap-2">
          <button type="button" className={buttonClass} disabled={!unit || !!progress || saving || files.length > BATCH_MAX_FILES} onClick={() => void run()}>Prepare files</button>
          {progress && <button type="button" className={buttonClass} onClick={() => controller.current?.abort()}>Cancel batch</button>}
          {result && <button type="button" className={buttonClass} disabled={saving} onClick={() => void save()}>Export ZIP</button>}
        </div>
        {progress && <p role="status">{progress.completed}/{progress.total}: {progress.name}</p>}
        {result && <div>
          <p role="status">{result.entries.filter((entry) => entry.status === 'success').length} prepared, {result.entries.filter((entry) => entry.status === 'failed').length} failed, {result.entries.filter((entry) => entry.status === 'skipped').length} skipped.</p>
          <ul className="max-h-32 overflow-auto">{result.entries.map((entry, index) => <li key={index}>{entry.source.split(/[\\/]/).pop()}: {entry.status}{entry.reason ? `, ${entry.reason}` : ''}</li>)}</ul>
        </div>}
        {message && <p role="status">{message}</p>}
      </section>}
    </div>
  )
}
