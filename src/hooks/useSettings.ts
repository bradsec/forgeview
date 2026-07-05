import { useEffect, useRef } from 'react'
import { useViewerStore } from '../store/viewerStore'
import type { QualityPreset, PerformanceOverrides } from '../utils/performancePresets'
import type { ThemeMode } from '../themes'
import { isTauri } from '../utils/isTauri'

interface SettingsFile {
  performance: {
    preset: QualityPreset
    overrides: PerformanceOverrides
  }
  theme?: ThemeMode
}

const SETTINGS_PATH = 'settings.json'

async function getTauriFs() {
  if (!isTauri()) return null
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
  const theme = useViewerStore((s) => s.theme)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initializedRef = useRef(false)

  // Load settings on mount
  useEffect(() => {
    loadSettings()
      .then((data) => {
        if (data?.performance) {
          const store = useViewerStore.getState()
          store.setPerformancePreset(data.performance.preset)
          // Re-apply overrides after preset reset them
          if (data.performance.overrides && Object.keys(data.performance.overrides).length > 0) {
            useViewerStore.setState({ performanceOverrides: data.performance.overrides })
          }
        }
        if (data?.theme) {
          useViewerStore.getState().setTheme(data.theme)
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
