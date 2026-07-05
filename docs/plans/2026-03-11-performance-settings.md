# Performance Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add quality presets (Low/Medium/High) with advanced overrides in a settings modal, persisted to disk, driving reactive renderer reconfiguration.

**Architecture:** Performance settings live in Zustand store. A `getEffectiveSettings()` selector merges preset defaults with user overrides. Viewer3D watches effective settings and reconfigures renderer/scene in-place (or recreates renderer for antialiasing). Settings persist to `appConfigDir/settings.json` via Tauri fs plugin.

**Tech Stack:** React 19, Three.js r183, Zustand 5, Tailwind CSS v4, Tauri v2 fs plugin

---

### Task 1: Add preset definitions and effective settings resolver

**Files:**
- Create: `src/utils/performancePresets.ts`

**Step 1: Create the presets module**

```typescript
// src/utils/performancePresets.ts
import * as THREE from 'three'

export type QualityPreset = 'low' | 'medium' | 'high'

export interface EffectiveSettings {
  antialias: boolean
  pixelRatio: number       // actual value to pass to renderer
  toneMapping: THREE.ToneMapping
  toneMappingExposure: number
  maxLights: number        // 2, 3, or 4
  damping: boolean
  gridDivisions: number    // 10 or 20
}

export interface PerformanceOverrides {
  antialias?: boolean | null
  pixelRatio?: number | null       // 1.0, 1.5, 2.0, or null for preset default
  toneMapping?: boolean | null
  maxLights?: number | null
  damping?: boolean | null
  gridDivisions?: number | null
}

const PRESET_DEFAULTS: Record<QualityPreset, EffectiveSettings> = {
  low: {
    antialias: false,
    pixelRatio: 1.0,
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1.0,
    maxLights: 2,
    damping: false,
    gridDivisions: 10,
  },
  medium: {
    antialias: true,
    pixelRatio: Math.min(window.devicePixelRatio, 2),
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1.2,
    maxLights: 3,
    damping: true,
    gridDivisions: 20,
  },
  high: {
    antialias: true,
    pixelRatio: window.devicePixelRatio,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1.2,
    maxLights: 4,
    damping: true,
    gridDivisions: 20,
  },
}

export function getEffectiveSettings(
  preset: QualityPreset,
  overrides: PerformanceOverrides
): EffectiveSettings {
  const base = { ...PRESET_DEFAULTS[preset] }

  if (overrides.antialias != null) base.antialias = overrides.antialias
  if (overrides.pixelRatio != null) base.pixelRatio = overrides.pixelRatio
  if (overrides.toneMapping != null) {
    base.toneMapping = overrides.toneMapping
      ? THREE.ACESFilmicToneMapping
      : THREE.NoToneMapping
    base.toneMappingExposure = overrides.toneMapping ? 1.2 : 1.0
  }
  if (overrides.maxLights != null) base.maxLights = overrides.maxLights
  if (overrides.damping != null) base.damping = overrides.damping
  if (overrides.gridDivisions != null) base.gridDivisions = overrides.gridDivisions

  return base
}

export function getPresetDefaults(preset: QualityPreset): EffectiveSettings {
  return { ...PRESET_DEFAULTS[preset] }
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/utils/performancePresets.ts
git commit -m "feat: add performance preset definitions and effective settings resolver"
```

---

### Task 2: Add performance settings to Zustand store

**Files:**
- Modify: `src/store/viewerStore.ts`

**Step 1: Add imports and state**

At the top of `viewerStore.ts`, add the import:

```typescript
import type { QualityPreset, PerformanceOverrides } from '../utils/performancePresets'
```

Add to the `ViewerState` interface (after `sidebarVisible: boolean`):

```typescript
  // Performance settings
  performancePreset: QualityPreset
  performanceOverrides: PerformanceOverrides
  settingsOpen: boolean

  setPerformancePreset: (preset: QualityPreset) => void
  setPerformanceOverride: (key: keyof PerformanceOverrides, value: any) => void
  resetPerformanceOverrides: () => void
  setSettingsOpen: (open: boolean) => void
```

Add to the `create` initializer (after `sidebarVisible: true`):

```typescript
  // Performance settings
  performancePreset: 'high' as QualityPreset,
  performanceOverrides: {} as PerformanceOverrides,
  settingsOpen: false,

  setPerformancePreset: (preset) =>
    set({ performancePreset: preset, performanceOverrides: {} }),
  setPerformanceOverride: (key, value) =>
    set((state) => ({
      performanceOverrides: { ...state.performanceOverrides, [key]: value },
    })),
  resetPerformanceOverrides: () =>
    set({ performancePreset: 'high', performanceOverrides: {} }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/store/viewerStore.ts
git commit -m "feat: add performance settings state to viewer store"
```

---

### Task 3: Add settings persistence hook

**Files:**
- Create: `src/hooks/useSettings.ts`
- Modify: `src-tauri/capabilities/default.json`

**Step 1: Add write permissions to Tauri capabilities**

In `src-tauri/capabilities/default.json`, add these permissions to the array:

```json
"fs:allow-write-file",
"fs:allow-mkdir",
"fs:scope-appconfig-recursive"
```

**Step 2: Create the persistence hook**

```typescript
// src/hooks/useSettings.ts
import { useEffect, useRef } from 'react'
import { useViewerStore } from '../store/viewerStore'
import type { QualityPreset, PerformanceOverrides } from '../utils/performancePresets'

interface SettingsFile {
  performance: {
    preset: QualityPreset
    overrides: PerformanceOverrides
  }
}

const SETTINGS_PATH = 'settings.json'

async function getTauriFs() {
  if (!(window as any).__TAURI_INTERNALS__) return null
  const [fs, path] = await Promise.all([
    import('@tauri-apps/plugin-fs'),
    import('@tauri-apps/api/path'),
  ])
  return { fs, path }
}

async function loadSettings(): Promise<SettingsFile | null> {
  const tauri = await getTauriFs()
  if (!tauri) return null

  try {
    const configDir = await tauri.path.appConfigDir()
    const filePath = `${configDir}${SETTINGS_PATH}`
    const contents = await tauri.fs.readTextFile(filePath)
    return JSON.parse(contents) as SettingsFile
  } catch {
    return null
  }
}

async function saveSettings(data: SettingsFile): Promise<void> {
  const tauri = await getTauriFs()
  if (!tauri) return

  try {
    const configDir = await tauri.path.appConfigDir()
    await tauri.fs.mkdir(configDir, { recursive: true })
    const filePath = `${configDir}${SETTINGS_PATH}`
    await tauri.fs.writeTextFile(filePath, JSON.stringify(data, null, 2))
  } catch (err) {
    console.warn('Failed to save settings:', err)
  }
}

export function useSettingsPersistence() {
  const preset = useViewerStore((s) => s.performancePreset)
  const overrides = useViewerStore((s) => s.performanceOverrides)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initializedRef = useRef(false)

  // Load settings on mount
  useEffect(() => {
    loadSettings().then((data) => {
      if (data?.performance) {
        const store = useViewerStore.getState()
        store.setPerformancePreset(data.performance.preset)
        // Re-apply overrides after preset reset them
        if (data.performance.overrides && Object.keys(data.performance.overrides).length > 0) {
          useViewerStore.setState({ performanceOverrides: data.performance.overrides })
        }
      }
      initializedRef.current = true
    })
  }, [])

  // Save settings on change (debounced 500ms)
  useEffect(() => {
    if (!initializedRef.current) return

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      saveSettings({ performance: { preset, overrides } })
    }, 500)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [preset, overrides])
}
```

**Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/hooks/useSettings.ts src-tauri/capabilities/default.json
git commit -m "feat: add settings persistence hook with Tauri fs"
```

---

### Task 4: Create SettingsModal component

**Files:**
- Create: `src/components/SettingsModal.tsx`

**Step 1: Create the modal**

```typescript
// src/components/SettingsModal.tsx
import { useState } from 'react'
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
      <span className="text-sm text-gray-300">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          'relative w-9 h-5 rounded-full transition-colors',
          checked ? 'bg-blue-600' : 'bg-gray-600',
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
      <span className="text-sm text-gray-300">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-gray-700 text-gray-200 text-sm rounded px-2 py-1 border border-gray-600"
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
  const [advancedOpen, setAdvancedOpen] = useState(false)

  if (!settingsOpen) return null

  const defaults = getPresetDefaults(preset)
  const close = () => useViewerStore.getState().setSettingsOpen(false)

  // Resolve displayed values: override ?? preset default
  const antialias = overrides.antialias ?? defaults.antialias
  const pixelRatio = overrides.pixelRatio ?? 0 // 0 = Native / preset default
  const toneMapping =
    overrides.toneMapping ?? (defaults.toneMapping !== 0) // NoToneMapping = 0
  const maxLights = overrides.maxLights ?? defaults.maxLights
  const damping = overrides.damping ?? defaults.damping
  const gridDivisions = overrides.gridDivisions ?? defaults.gridDivisions

  const setOverride = (key: keyof PerformanceOverrides, value: any) =>
    useViewerStore.getState().setPerformanceOverride(key, value)

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={close} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-xl w-full max-w-sm">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
            <h2 className="text-base font-semibold text-gray-100">Settings</h2>
            <button
              onClick={close}
              className="text-gray-400 hover:text-gray-200 text-lg leading-none"
              aria-label="Close settings"
            >
              &times;
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4">
            {/* Quality Preset */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
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
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
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
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 hover:text-gray-300"
            >
              <span className="text-[10px]">{advancedOpen ? '\u25BE' : '\u25B8'}</span>
              Advanced
            </button>

            {advancedOpen && (
              <div className="flex flex-col border-t border-gray-700 pt-2">
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
          <div className="px-5 py-3 border-t border-gray-700 flex justify-between">
            <button
              type="button"
              onClick={() => useViewerStore.getState().resetPerformanceOverrides()}
              className="text-sm text-gray-400 hover:text-gray-200 transition-colors"
            >
              Reset to Defaults
            </button>
            <button
              type="button"
              onClick={close}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/SettingsModal.tsx
git commit -m "feat: add SettingsModal with presets and advanced overrides"
```

---

### Task 5: Add gear icon to Toolbar and wire SettingsModal into App

**Files:**
- Modify: `src/components/Toolbar.tsx`
- Modify: `src/App.tsx`

**Step 1: Add gear button to Toolbar**

In `src/components/Toolbar.tsx`, add a gear icon button inside the right-side `<div className="ml-auto ...">`, just before the Details button (before the `{/* Toggle sidebar visibility */}` comment):

```tsx
        {/* Settings gear */}
        <button
          type="button"
          onClick={() => useViewerStore.getState().setSettingsOpen(true)}
          className="px-2 py-1.5 text-sm rounded transition-colors bg-gray-700 text-gray-400 hover:text-gray-200 ml-2"
          title="Settings"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z"/>
            <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.902 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 002.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 001.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 00-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 00-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 00-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291a1.873 1.873 0 00-1.116-2.693l-.318-.094c-.835-.246-.835-1.428 0-1.674l.319-.094a1.873 1.873 0 001.115-2.692l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 002.692-1.116l.094-.318z"/>
          </svg>
        </button>
```

**Step 2: Wire SettingsModal and useSettingsPersistence into App.tsx**

In `src/App.tsx`, add imports:

```typescript
import { SettingsModal } from './components/SettingsModal'
import { useSettingsPersistence } from './hooks/useSettings'
```

Inside the `App` component function, before the return:

```typescript
  useSettingsPersistence()
```

Inside the return JSX, add `<SettingsModal />` just before the closing `</div>` of the root:

```tsx
      <SettingsModal />
    </div>
  )
```

**Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/Toolbar.tsx src/App.tsx
git commit -m "feat: wire settings gear icon and modal into app layout"
```

---

### Task 6: Apply performance settings in Viewer3D — in-place settings

**Files:**
- Modify: `src/components/Viewer3D.tsx`

This task applies the settings that can be changed in-place (everything except antialiasing, which requires renderer recreation).

**Step 1: Add imports and read effective settings**

At the top of `Viewer3D.tsx`, add:

```typescript
import { getEffectiveSettings } from '../utils/performancePresets'
```

Inside the component function, after the existing `const projectionMode = ...` line, add:

```typescript
  const performancePreset = useViewerStore((s) => s.performancePreset)
  const performanceOverrides = useViewerStore((s) => s.performanceOverrides)
```

**Step 2: Add light refs for dynamic management**

After `const gridRef = ...` line, add:

```typescript
  const lightsRef = useRef<THREE.Light[]>([])
```

**Step 3: Refactor Effect 1 lighting setup to use refs**

In Effect 1, replace the lighting block (lines 126-140) with:

```typescript
    // Lighting — store refs for dynamic light management
    const hemisphere = new THREE.HemisphereLight(0xddeeff, 0x0d0d0d, 0.8)
    scene.add(hemisphere)
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2)
    keyLight.position.set(5, 10, 7)
    keyLight.name = 'keyLight'
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0xb0c4de, 0.6)
    fillLight.position.set(-5, 5, -5)
    fillLight.name = 'fillLight'
    scene.add(fillLight)
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.3)
    rimLight.position.set(0, -3, -8)
    rimLight.name = 'rimLight'
    scene.add(rimLight)
    lightsRef.current = [hemisphere, keyLight, fillLight, rimLight]
```

**Step 4: Remove `shadowMap.enabled = true`**

In Effect 1, delete this line:

```typescript
    renderer.shadowMap.enabled = true
```

**Step 5: Add Effect 7 — apply in-place performance settings**

After Effect 6 (projection mode toggle), add a new effect:

```typescript
  // Effect 7: Apply performance settings — in-place reconfiguration
  useEffect(() => {
    const settings = getEffectiveSettings(performancePreset, performanceOverrides)

    // Pixel ratio
    if (rendererRef.current) {
      rendererRef.current.setPixelRatio(settings.pixelRatio)
      if (mountRef.current) {
        rendererRef.current.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight)
      }
    }

    // Tone mapping
    if (rendererRef.current) {
      rendererRef.current.toneMapping = settings.toneMapping
      rendererRef.current.toneMappingExposure = settings.toneMappingExposure
    }

    // Damping
    if (controlsRef.current) {
      controlsRef.current.enableDamping = settings.damping
    }

    // Lights — show/hide based on maxLights
    // Order: [0]=hemisphere (always on), [1]=key (always on), [2]=fill, [3]=rim
    const lights = lightsRef.current
    if (lights.length === 4) {
      lights[0].visible = true   // hemisphere — always
      lights[1].visible = true   // key — always
      lights[2].visible = settings.maxLights >= 3  // fill
      lights[3].visible = settings.maxLights >= 4  // rim
    }

    // Grid divisions — rebuild grid if different
    if (gridRef.current && sceneRef.current) {
      // Check current grid divisions by comparing geometry
      const currentDivs = (gridRef.current as any)._divisions as number | undefined
      if (currentDivs !== settings.gridDivisions) {
        const oldGrid = gridRef.current
        const pos = oldGrid.position.clone()
        const args = oldGrid.geometry.parameters as any
        const gridSize = args?.width ?? 200
        sceneRef.current.remove(oldGrid)
        oldGrid.dispose()
        const newGrid = new THREE.GridHelper(gridSize, settings.gridDivisions, 0x444466, 0x333355)
        newGrid.position.copy(pos)
        ;(newGrid as any)._divisions = settings.gridDivisions
        sceneRef.current.add(newGrid)
        gridRef.current = newGrid
      }
    }
  }, [performancePreset, performanceOverrides])
```

**Step 6: Tag grids with `_divisions` on creation**

In Effect 1, after creating the grid (line 143-144), add:

```typescript
    ;(grid as any)._divisions = 20
```

In Effect 2, after creating `newGrid` in the single-model section, add:

```typescript
          ;(newGrid as any)._divisions = useViewerStore.getState().performanceOverrides.gridDivisions ?? 20
```

In Effect 5, after creating `newGrid` in the multi-model section, add:

```typescript
          ;(newGrid as any)._divisions = useViewerStore.getState().performanceOverrides.gridDivisions ?? 20
```

Also in Effects 2 and 5, use the effective grid divisions when creating the grid. Replace the hardcoded `20` in `new THREE.GridHelper(gridSize, 20, ...)` with:

```typescript
const { gridDivisions } = getEffectiveSettings(
  useViewerStore.getState().performancePreset,
  useViewerStore.getState().performanceOverrides
)
```

And use `gridDivisions` instead of `20`.

**Step 7: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 8: Commit**

```bash
git add src/components/Viewer3D.tsx
git commit -m "feat: apply performance settings in-place (pixel ratio, lights, tone mapping, damping, grid)"
```

---

### Task 7: Apply performance settings in Viewer3D — antialiasing (renderer recreation)

**Files:**
- Modify: `src/components/Viewer3D.tsx`

Antialiasing requires disposing the WebGL renderer and creating a new one.

**Step 1: Track current antialias state**

Add a ref after the existing refs:

```typescript
  const antialiasRef = useRef(true) // matches initial renderer creation
```

**Step 2: Add antialiasing handling to Effect 7**

At the beginning of Effect 7, before the pixel ratio section, add:

```typescript
    // Antialiasing — requires renderer recreation
    if (rendererRef.current && mountRef.current && settings.antialias !== antialiasRef.current) {
      const container = mountRef.current
      const oldRenderer = rendererRef.current

      const newRenderer = new THREE.WebGLRenderer({ antialias: settings.antialias })
      newRenderer.setPixelRatio(settings.pixelRatio)
      newRenderer.setSize(container.clientWidth, container.clientHeight)
      newRenderer.toneMapping = settings.toneMapping
      newRenderer.toneMappingExposure = settings.toneMappingExposure

      // Swap DOM elements
      container.removeChild(oldRenderer.domElement)
      container.appendChild(newRenderer.domElement)
      oldRenderer.dispose()

      // Reconnect OrbitControls to new DOM element
      if (controlsRef.current) {
        controlsRef.current.dispose()
        const controls = new OrbitControls(cameraRef.current!, newRenderer.domElement)
        controls.enableDamping = settings.damping
        controls.mouseButtons = {
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT: THREE.MOUSE.PAN,
        }
        controlsRef.current = controls
      }

      // Re-attach double-click handler
      const raycaster = new THREE.Raycaster()
      const mouse = new THREE.Vector2()
      newRenderer.domElement.addEventListener('dblclick', (e: MouseEvent) => {
        const targets: THREE.Object3D[] = []
        if (modelGroupRef.current) targets.push(modelGroupRef.current)
        for (const obj of modelMapRef.current.values()) targets.push(obj)
        if (targets.length === 0) return
        const rect = newRenderer.domElement.getBoundingClientRect()
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
        raycaster.setFromCamera(mouse, cameraRef.current!)
        const hits = raycaster.intersectObjects(targets, true)
        if (hits.length > 0) {
          controlsRef.current!.target.copy(hits[0].point)
          controlsRef.current!.update()
        }
      })

      rendererRef.current = newRenderer
      antialiasRef.current = settings.antialias

      // Skip remaining in-place updates since we just configured the new renderer
      return
    }
```

**Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/Viewer3D.tsx
git commit -m "feat: handle antialiasing toggle via renderer recreation"
```

---

### Task 8: Manual testing and polish

**Step 1: Start the app**

```bash
cd /home/mark/Code/forge-view && PATH="$HOME/.cargo/bin:$PATH" pnpm tauri dev
```

**Step 2: Test checklist**

Use Playwright against `http://localhost:1420`:

1. **Gear icon visible** in toolbar, opens settings modal on click
2. **Preset buttons** — click Low/Medium/High, each highlights correctly
3. **Advanced expander** — click to open, reveals toggles and dropdowns
4. **Close modal** — X button closes, backdrop click closes, Done button closes
5. **Reset to Defaults** — sets preset back to High, clears advanced overrides
6. **Settings persist** — change to Low, close app, reopen, verify Low is still selected (Tauri-only test)

Visual verification (requires a loaded model — Tauri-only):
7. **Low preset** — noticeably less smooth (no AA, lower pixel ratio), fewer lights
8. **High preset** — full quality restored
9. **Individual overrides** — toggle antialiasing off while on High, verify jagged edges

**Step 3: Fix any issues found**

**Step 4: Commit**

```bash
git add -u
git commit -m "fix: polish performance settings after testing"
```
