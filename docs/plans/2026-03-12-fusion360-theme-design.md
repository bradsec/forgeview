# Fusion 360-Inspired Theme System Design

## Summary

Implement a dark/light theme system inspired by Autodesk Fusion 360's color scheme, with CSS custom properties driving all UI chrome colors and a JS theme definition driving Three.js scene colors (viewport gradient, lighting, grid, model material).

## Decisions

- **Fusion-inspired** (not exact replica) — adapt Fusion 360's palette to our simpler UI
- **Subtle viewport gradient** — dark navy gradient (dark) / gray gradient (light), not HDR environments
- **Theme-aware materials** — model color and lighting adjust per theme to prevent washout
- **Toggle in toolbar + Settings** — sun/moon quick-toggle button plus full option in SettingsModal

## Theme Architecture

Centralized theme definition with CSS custom properties, driven by Zustand store (`theme: 'dark' | 'light'`). A root class of `theme-dark` or `theme-light` switches all variables. Three.js scene values read from a JS theme object.

### New Files

- `src/themes/index.ts` — Theme type, dark/light color objects (UI tokens + scene values)
- `src/themes/cssVariables.ts` — Effect that writes CSS vars to `:root` on theme change

### Store Addition (viewerStore.ts)

```ts
theme: 'dark' | 'light'
setTheme: (theme) => void
toggleTheme: () => void
```

Persisted to `localStorage`.

## Color Palette — Dark Theme

| Token | Hex | Usage |
|---|---|---|
| `--bg-app` | `#2D2D2D` | Root app background |
| `--bg-toolbar` | `#383838` | Toolbar bar |
| `--bg-panel` | `#323232` | Sidebar, directory panel |
| `--bg-dialog` | `#3B3B3B` | Settings modal |
| `--bg-button` | `#424447` | Standard buttons |
| `--bg-button-hover` | `#4A4D51` | Button hover |
| `--bg-button-active` | `#354F85` | Active/selected button |
| `--bg-input` | `#424447` | Select dropdowns, inputs |
| `--border` | `#2C2C2C` | Borders, dividers |
| `--border-input` | `#505050` | Input/select borders |
| `--text-primary` | `#C0C0C6` | Body text |
| `--text-bright` | `#EEEEEE` | Selected/important text |
| `--text-muted` | `#777777` | Secondary/disabled text |
| `--text-label` | `#A5A5AA` | Labels, section headers |
| `--accent` | `#0696D7` | Brand blue |
| `--accent-hover` | `#42B6DF` | Blue hover |
| `--accent-button` | `#354F85` | Blue button bg |
| `--accent-button-hover` | `#3D5A96` | Blue button hover |
| `--error` | `#EB5555` | Error red |
| `--warning` | `#FBB549` | Warning amber |
| `--success` | `#669653` | Success green |

### Dark Scene Values

| Token | Value | Usage |
|---|---|---|
| `--scene-bg-top` | `#1A1E2E` | Viewport gradient top |
| `--scene-bg-bottom` | `#2A2E3E` | Viewport gradient bottom |
| `--grid-primary` | `#3A3A4A` | Grid lines |
| `--grid-secondary` | `#2E2E3E` | Grid subdivisions |
| `--model-color` | `#B0B0B0` | Default model material |
| `--hemisphere-sky` | `#DDEEFF` | Hemisphere light |
| `--hemisphere-ground` | `#0D0D0D` | Hemisphere ground |
| Key light intensity | `1.2` | |
| Fill light intensity | `0.6` | |

## Color Palette — Light Theme

| Token | Hex | Usage |
|---|---|---|
| `--bg-app` | `#E8E8E8` | Root app background |
| `--bg-toolbar` | `#F0F0F0` | Toolbar bar |
| `--bg-panel` | `#F5F5F5` | Sidebar, directory panel |
| `--bg-dialog` | `#FFFFFF` | Settings modal |
| `--bg-button` | `#E0E0E0` | Standard buttons |
| `--bg-button-hover` | `#D0D0D0` | Button hover |
| `--bg-button-active` | `#0696D7` | Active/selected button |
| `--bg-input` | `#FFFFFF` | Select dropdowns, inputs |
| `--border` | `#D5D5D5` | Borders, dividers |
| `--border-input` | `#C9C9C9` | Input/select borders |
| `--text-primary` | `#333333` | Body text |
| `--text-bright` | `#1A1A1A` | Selected/important text |
| `--text-muted` | `#858585` | Secondary/disabled text |
| `--text-label` | `#666666` | Labels, section headers |
| `--accent` | `#0696D7` | Brand blue |
| `--accent-hover` | `#007FC6` | Blue hover (darker in light) |
| `--accent-button` | `#0696D7` | Blue button bg |
| `--accent-button-hover` | `#007FC6` | Blue button hover |
| `--error` | `#D93025` | Error red |
| `--warning` | `#E8A020` | Warning amber |
| `--success` | `#1E8E3E` | Success green |

### Light Scene Values

| Token | Value | Usage |
|---|---|---|
| `--scene-bg-top` | `#B8BCC8` | Viewport gradient top |
| `--scene-bg-bottom` | `#D0D4DA` | Viewport gradient bottom |
| `--grid-primary` | `#A0A0AA` | Grid lines |
| `--grid-secondary` | `#B8B8C2` | Grid subdivisions |
| `--model-color` | `#909090` | Default model material (darker) |
| `--hemisphere-sky` | `#FFFFFF` | Hemisphere light |
| `--hemisphere-ground` | `#404040` | Hemisphere ground |
| Key light intensity | `1.0` | Reduced |
| Fill light intensity | `0.4` | Reduced |

## Component Changes

### Toolbar.tsx
- CSS var colors throughout
- Flat button style: `rounded-sm`, tighter padding, 1px borders
- Button groups: related buttons in shared border container with no gaps
- Active state: bottom accent border or subtle accent bg
- Vertical separator dividers between groups
- Sun/moon theme toggle button on right side

### Sidebar.tsx
- Background → `--bg-panel`, borders → `--border`
- Section headers → `--text-label`, values → `--text-primary`

### SettingsModal.tsx
- All colors → CSS variables
- New "Appearance" section at top with Dark/Light toggle

### DirectoryPanel.tsx
- Color token swaps for backgrounds, borders, text
- Folder icon stays yellow (semantic, not chrome)

### DropZone.tsx
- Background → `--bg-app`, button → `--accent-button`

### SceneControls.tsx
- Button backgrounds → `--bg-button` with backdrop blur

### ModelList.tsx
- Color token swaps throughout

### Viewer3D.tsx (JS-driven, not CSS)
- Background gradient via two `THREE.Color` values from theme
- Grid colors from theme
- Hemisphere light colors and intensities from theme
- Key/fill light intensities from theme
- Default model material color from theme
- All update on theme switch via effect

### App.tsx
- Apply `theme-dark`/`theme-light` class to root div
- Swap hardcoded colors to CSS vars

### No changes
- `ViewCube.tsx` — face colors are spatial, not chrome
- `src/loaders/index.ts` — material color applied by Viewer3D
- Rust backend — no theme awareness needed

## Behavior

- Default theme: `dark`
- Toggle: toolbar sun/moon button or Settings > Appearance
- Persisted in `localStorage`
- UI updates instantly via CSS vars
- Scene updates in same frame via Three.js effect
- New models get theme-appropriate material color
- Existing models update material on theme switch
