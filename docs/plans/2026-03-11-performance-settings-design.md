# Performance Settings Design

**Goal:** Add quality presets (Low/Medium/High) with advanced overrides so users on less powerful hardware can reduce rendering load. Settings persist across sessions via a config file.

**Approach:** Store-driven renderer reconfiguration (Approach A). Performance settings live in Zustand, Viewer3D reads them reactively, a Settings Modal provides the UI.

---

## State Shape

Added to `viewerStore.ts`:

```typescript
type QualityPreset = 'low' | 'medium' | 'high'

interface PerformanceSettings {
  preset: QualityPreset
  // Advanced overrides (null = use preset default)
  antialias: boolean | null
  pixelRatio: number | null        // 1.0, 1.5, 2.0, or null for native
  toneMapping: boolean | null
  maxLights: number | null          // 2, 3, or 4
  damping: boolean | null
  gridDivisions: number | null      // 10 or 20
}
```

A `getEffectiveSettings()` selector merges preset defaults with non-null overrides. Changing preset resets all overrides to `null`.

## Preset Definitions

| Setting | Low | Medium | High (default) |
|---|---|---|---|
| Antialiasing | Off | On | On |
| Pixel ratio | 1.0 | native (cap 2) | native (uncapped) |
| Tone mapping | None | ACES Filmic | ACES Filmic |
| Max lights | 2 (ambient + 1 dir) | 3 (ambient + 2 dir) | 4 (all current) |
| Damping | Off | On | On |
| Grid divisions | 10 | 20 | 20 |

Shadow mapping is disabled across all presets (currently enabled but unused).

## Settings Modal

Triggered by a gear icon in the Toolbar. Components:

- **Preset selector**: Three buttons (Low / Medium / High), active one highlighted
- **Advanced expander**: Collapsible section with individual controls:
  - Antialiasing: toggle
  - Pixel ratio: dropdown (1x / 1.5x / 2x / Native)
  - Tone mapping: toggle
  - Lighting quality: dropdown (Basic / Standard / Full)
  - Controls damping: toggle
  - Grid detail: dropdown (Simple / Standard)
- **Reset to Defaults** button
- **Close** button (X), backdrop click dismisses

Dark theme, consistent with existing UI.

## Renderer Reconfiguration

Viewer3D watches `getEffectiveSettings()` via useEffect:

| Setting | Reconfiguration method |
|---|---|
| Antialiasing | Dispose + recreate renderer (reuse scene/camera/controls) |
| Pixel ratio | `renderer.setPixelRatio()` + `renderer.setSize()` in-place |
| Tone mapping | `renderer.toneMapping` assignment in-place |
| Lights | Add/remove directional lights from scene in-place |
| Damping | `controls.enableDamping` assignment in-place |
| Grid | Dispose old grid, create new one in-place |

## Persistence

- File: `~/.config/forge-view/settings.json` via Tauri `fs` plugin
- Load on app start before first render, fall back to `high` if missing/corrupt
- Save on every change, debounced 500ms
- Format: `{ "performance": { "preset": "high", "overrides": {} } }`
- Reset to Defaults button clears file and restores `high` preset

## Shadow Map Cleanup

Remove `shadowMap.enabled = true` from renderer setup — no lights cast shadows, so this is wasted GPU overhead. Free win across all presets.

## Files to Create

- `src/components/SettingsModal.tsx` — Modal UI with presets + advanced controls
- `src/utils/performancePresets.ts` — Preset definitions + `getEffectiveSettings()` logic
- `src/hooks/useSettings.ts` — Load/save settings via Tauri fs

## Files to Modify

- `src/store/viewerStore.ts` — Add `PerformanceSettings` state + actions
- `src/components/Viewer3D.tsx` — Read effective settings, reconfigure renderer/scene
- `src/components/Toolbar.tsx` — Add gear icon button to open settings modal
- `src/App.tsx` — Render SettingsModal
