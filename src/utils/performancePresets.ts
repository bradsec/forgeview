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
