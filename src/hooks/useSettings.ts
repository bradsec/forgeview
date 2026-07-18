import { useEffect, useRef } from 'react'
import { useViewerStore } from '../store/viewerStore'
import type { QualityPreset, PerformanceOverrides } from '../utils/performancePresets'
import type { ThemeMode } from '../themes'
import { isTauri } from '../utils/isTauri'
import * as fs from '@tauri-apps/plugin-fs'
import * as path from '@tauri-apps/api/path'

interface SettingsFile {
  performance: {
    preset: QualityPreset
    overrides: PerformanceOverrides
  }
  theme?: ThemeMode
}

const SETTINGS_PATH = 'settings.json'

const VALID_PRESETS: QualityPreset[] = ['low', 'medium', 'high']

/**
 * Keep only known override keys with sane values. A hand-edited or corrupt
 * settings.json must not push NaN/garbage into the renderer (pixelRatio,
 * maxLights and gridDivisions feed WebGL calls directly).
 */
export function sanitizeOverrides(raw: unknown): PerformanceOverrides {
  if (typeof raw !== 'object' || raw === null) return {}
  const o = raw as Record<string, unknown>
  const out: PerformanceOverrides = {}
  if (typeof o.antialias === 'boolean') out.antialias = o.antialias
  if (typeof o.pixelRatio === 'number' && o.pixelRatio >= 0.5 && o.pixelRatio <= 4) out.pixelRatio = o.pixelRatio
  if (typeof o.toneMapping === 'boolean') out.toneMapping = o.toneMapping
  if (typeof o.maxLights === 'number' && [2, 3, 4].includes(o.maxLights)) out.maxLights = o.maxLights
  if (typeof o.damping === 'boolean') out.damping = o.damping
  if (typeof o.gridDivisions === 'number' && [10, 20].includes(o.gridDivisions)) out.gridDivisions = o.gridDivisions
  return out
}

async function getTauriFs() {
  if (!isTauri()) return null
  return { fs, path }
}

async function loadSettings(): Promise<SettingsFile | null> {
  const tauri = await getTauriFs()
  if (!tauri) return null

  try {
    const configDir = await tauri.path.appConfigDir()
    const filePath = await tauri.path.join(configDir, SETTINGS_PATH)
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
    const filePath = await tauri.path.join(configDir, SETTINGS_PATH)
    await tauri.fs.writeTextFile(filePath, JSON.stringify(data, null, 2))
  } catch (err) {
    console.warn('Failed to save settings:', err)
  }
}

export function useSettingsPersistence() {
  const preset = useViewerStore((s) => s.performancePreset)
  const overrides = useViewerStore((s) => s.performanceOverrides)
  const theme = useViewerStore((s) => s.theme)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initializedRef = useRef(false)

  // Load settings on mount
  useEffect(() => {
    const initial = useViewerStore.getState()
    loadSettings()
      .then((data) => {
        if (data?.performance && VALID_PRESETS.includes(data.performance.preset)) {
          const store = useViewerStore.getState()
          if (
            store.performancePreset === initial.performancePreset &&
            store.performanceOverrides === initial.performanceOverrides
          ) {
            store.setPerformancePreset(data.performance.preset)
            const overrides = sanitizeOverrides(data.performance.overrides)
            if (Object.keys(overrides).length > 0) {
              useViewerStore.setState({ performanceOverrides: overrides })
            }
          }
        }
        if (data?.theme === 'dark' || data?.theme === 'light') {
          const store = useViewerStore.getState()
          if (store.theme === initial.theme) store.setTheme(data.theme)
        }
      })
      .catch(() => {
        // Settings file doesn't exist yet or is corrupt — use defaults
      })
      .finally(() => {
        initializedRef.current = true
      })
  }, [])

  // Save settings on change (debounced 500ms)
  useEffect(() => {
    if (!initializedRef.current) return

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      saveSettings({ performance: { preset, overrides }, theme })
    }, 500)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [preset, overrides, theme])
}
