import { useEffect, useRef, useState } from 'react'
import { useViewerStore } from '../store/viewerStore'
import { getPresetDefaults } from '../utils/performancePresets'
import type { QualityPreset, PerformanceOverrides } from '../utils/performancePresets'

const PRESETS: { key: QualityPreset; label: string; desc: string }[] = [
  { key: 'low', label: 'Low', desc: 'Best performance' },
  { key: 'medium', label: 'Medium', desc: 'Balanced' },
  { key: 'high', label: 'High', desc: 'Best quality' },
]

const PIXEL_RATIO_OPTIONS = [
  { value: 1.0, label: '1x' },
  { value: 1.5, label: '1.5x' },
  { value: 2.0, label: '2x' },
  { value: 0, label: 'Native' }, // 0 = sentinel for "use preset default"
]

const LIGHT_OPTIONS = [
  { value: 2, label: 'Basic (2 lights)' },
  { value: 3, label: 'Standard (3 lights)' },
  { value: 4, label: 'Full (4 lights)' },
]

const GRID_OPTIONS = [
  { value: 10, label: 'Simple (10)' },
  { value: 20, label: 'Standard (20)' },
]

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (val: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between py-1.5 cursor-pointer">
      <span className="text-sm text-[var(--text-primary)]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          'relative w-9 h-5 rounded-full transition-colors',
          checked ? 'bg-[var(--accent)]' : 'bg-[var(--bg-button)]',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
            checked ? 'translate-x-4' : '',
          ].join(' ')}
        />
      </button>
    </label>
  )
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: number
  options: { value: number; label: string }[]
  onChange: (val: number) => void
}) {
  return (
    <label className="flex items-center justify-between py-1.5">
      <span className="text-sm text-[var(--text-primary)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-[var(--bg-input)] text-[var(--text-primary)] text-sm rounded px-2 py-1 border border-[var(--border-input)]"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function SettingsModal() {
  const settingsOpen = useViewerStore((s) => s.settingsOpen)
  const preset = useViewerStore((s) => s.performancePreset)
  const overrides = useViewerStore((s) => s.performanceOverrides)
  const theme = useViewerStore((s) => s.theme)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const close = () => useViewerStore.getState().setSettingsOpen(false)

  useEffect(() => {
    if (!settingsOpen) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    closeButtonRef.current?.focus()
    return () => previousFocusRef.current?.focus()
  }, [settingsOpen])

  if (!settingsOpen) return null

  const defaults = getPresetDefaults(preset)

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
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

  // Resolve displayed values: override ?? preset default
  const antialias = overrides.antialias ?? defaults.antialias
  const pixelRatio = overrides.pixelRatio ?? 0 // 0 = Native / preset default
  const toneMapping =
    overrides.toneMapping ?? (defaults.toneMapping !== 0) // NoToneMapping = 0
  const maxLights = overrides.maxLights ?? defaults.maxLights
  const damping = overrides.damping ?? defaults.damping
  const gridDivisions = overrides.gridDivisions ?? defaults.gridDivisions

  const setOverride = <K extends keyof PerformanceOverrides>(
    key: K,
    value: Exclude<PerformanceOverrides[K], undefined>
  ) =>
    useViewerStore.getState().setPerformanceOverride(key, value)

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-[var(--scrim)] z-40" onClick={close} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
          onKeyDown={handleKeyDown}
          className="bg-[var(--bg-dialog)] border border-[var(--border)] rounded shadow-[0_10px_40px_var(--shadow-color)] w-full max-w-sm"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
            <h2 id="settings-title" className="text-base font-semibold text-[var(--text-bright)]">Settings</h2>
            <button
              ref={closeButtonRef}
              onClick={close}
              className="text-[var(--text-label)] hover:text-[var(--text-primary)] text-lg leading-none"
              aria-label="Close settings"
            >
              &times;
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4">
            {/* Appearance */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-[var(--text-label)] uppercase tracking-wide mb-2">
                Appearance
              </p>
              <div className="flex gap-2">
                {(['dark', 'light'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => useViewerStore.getState().setTheme(t)}
                    className={[
                      'flex-1 py-2 rounded text-sm font-medium transition-colors',
                      theme === t
                        ? 'bg-[var(--accent-button)] text-[var(--text-on-accent)]'
                        : 'bg-[var(--bg-button)] text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]',
                    ].join(' ')}
                  >
                    {t === 'dark' ? 'Dark' : 'Light'}
                  </button>
                ))}
              </div>
            </div>

            {/* Quality Preset */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-[var(--text-label)] uppercase tracking-wide mb-2">
                Quality Preset
              </p>
              <div className="flex gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() =>
                      useViewerStore.getState().setPerformancePreset(p.key)
                    }
                    className={[
                      'flex-1 py-2 rounded text-sm font-medium transition-colors',
                      preset === p.key
                        ? 'bg-[var(--accent-button)] text-[var(--text-on-accent)]'
                        : 'bg-[var(--bg-button)] text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]',
                    ].join(' ')}
                    title={p.desc}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Advanced section */}
            <button
              type="button"
              onClick={() => setAdvancedOpen(!advancedOpen)}
              className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-label)] uppercase tracking-wide mb-2 hover:text-[var(--text-primary)]"
            >
              <span className="text-[10px]">{advancedOpen ? '\u25BE' : '\u25B8'}</span>
              Advanced
            </button>

            {advancedOpen && (
              <div className="flex flex-col border-t border-[var(--border)] pt-2">
                <Toggle
                  label="Antialiasing"
                  checked={antialias}
                  onChange={(v) => setOverride('antialias', v)}
                />
                <Select
                  label="Pixel Ratio"
                  value={pixelRatio}
                  options={PIXEL_RATIO_OPTIONS}
                  onChange={(v) => setOverride('pixelRatio', v === 0 ? null : v)}
                />
                <Toggle
                  label="Tone Mapping"
                  checked={toneMapping}
                  onChange={(v) => setOverride('toneMapping', v)}
                />
                <Select
                  label="Lighting"
                  value={maxLights}
                  options={LIGHT_OPTIONS}
                  onChange={(v) => setOverride('maxLights', v)}
                />
                <Toggle
                  label="Smooth Controls"
                  checked={damping}
                  onChange={(v) => setOverride('damping', v)}
                />
                <Select
                  label="Grid Detail"
                  value={gridDivisions}
                  options={GRID_OPTIONS}
                  onChange={(v) => setOverride('gridDivisions', v)}
                />
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-[var(--border)] flex justify-between">
            <button
              type="button"
              onClick={() => useViewerStore.getState().resetPerformanceOverrides()}
              className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              Reset to Defaults
            </button>
            <button
              type="button"
              onClick={close}
              className="px-4 py-1.5 bg-[var(--accent-button)] hover:bg-[var(--accent-button-hover)] text-[var(--text-on-accent)] text-sm rounded transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
