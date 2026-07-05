# Fusion 360-Inspired Theme System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add dark/light theme system inspired by Autodesk Fusion 360, with CSS custom properties for UI chrome and JS-driven scene color changes for Three.js viewport, lighting, grid, and model materials.

**Architecture:** A centralized theme definition (`src/themes/index.ts`) provides both CSS variable values and Three.js scene parameters. Zustand store gains `theme` state persisted to localStorage via the existing `useSettings` hook. A root `theme-dark`/`theme-light` class on the app div activates the correct CSS variable set. A Viewer3D effect reacts to theme changes for scene-level updates.

**Tech Stack:** React 19, Zustand 5, Tailwind CSS 4 (CSS-first), Three.js r183, Tauri v2

**Design doc:** `docs/plans/2026-03-12-fusion360-theme-design.md`

---

### Task 1: Create Theme Definition

**Files:**
- Create: `src/themes/index.ts`

**Step 1: Create the theme type and color objects**

```typescript
import * as THREE from 'three'

export type ThemeMode = 'dark' | 'light'

export interface ThemeColors {
  // UI chrome (CSS variable values)
  bgApp: string
  bgToolbar: string
  bgPanel: string
  bgDialog: string
  bgButton: string
  bgButtonHover: string
  bgButtonActive: string
  bgInput: string
  border: string
  borderInput: string
  textPrimary: string
  textBright: string
  textMuted: string
  textLabel: string
  accent: string
  accentHover: string
  accentButton: string
  accentButtonHover: string
  error: string
  warning: string
  success: string

  // Scene (Three.js values)
  sceneBgTop: number
  sceneBgBottom: number
  gridPrimary: number
  gridSecondary: number
  modelColor: number
  hemisphereSky: number
  hemisphereGround: number
  keyLightIntensity: number
  fillLightIntensity: number
}

export const darkTheme: ThemeColors = {
  bgApp: '#2D2D2D',
  bgToolbar: '#383838',
  bgPanel: '#323232',
  bgDialog: '#3B3B3B',
  bgButton: '#424447',
  bgButtonHover: '#4A4D51',
  bgButtonActive: '#354F85',
  bgInput: '#424447',
  border: '#2C2C2C',
  borderInput: '#505050',
  textPrimary: '#C0C0C6',
  textBright: '#EEEEEE',
  textMuted: '#777777',
  textLabel: '#A5A5AA',
  accent: '#0696D7',
  accentHover: '#42B6DF',
  accentButton: '#354F85',
  accentButtonHover: '#3D5A96',
  error: '#EB5555',
  warning: '#FBB549',
  success: '#669653',

  sceneBgTop: 0x1A1E2E,
  sceneBgBottom: 0x2A2E3E,
  gridPrimary: 0x3A3A4A,
  gridSecondary: 0x2E2E3E,
  modelColor: 0xB0B0B0,
  hemisphereSky: 0xDDEEFF,
  hemisphereGround: 0x0D0D0D,
  keyLightIntensity: 1.2,
  fillLightIntensity: 0.6,
}

export const lightTheme: ThemeColors = {
  bgApp: '#E8E8E8',
  bgToolbar: '#F0F0F0',
  bgPanel: '#F5F5F5',
  bgDialog: '#FFFFFF',
  bgButton: '#E0E0E0',
  bgButtonHover: '#D0D0D0',
  bgButtonActive: '#0696D7',
  bgInput: '#FFFFFF',
  border: '#D5D5D5',
  borderInput: '#C9C9C9',
  textPrimary: '#333333',
  textBright: '#1A1A1A',
  textMuted: '#858585',
  textLabel: '#666666',
  accent: '#0696D7',
  accentHover: '#007FC6',
  accentButton: '#0696D7',
  accentButtonHover: '#007FC6',
  error: '#D93025',
  warning: '#E8A020',
  success: '#1E8E3E',

  sceneBgTop: 0xB8BCC8,
  sceneBgBottom: 0xD0D4DA,
  gridPrimary: 0xA0A0AA,
  gridSecondary: 0xB8B8C2,
  modelColor: 0x909090,
  hemisphereSky: 0xFFFFFF,
  hemisphereGround: 0x404040,
  keyLightIntensity: 1.0,
  fillLightIntensity: 0.4,
}

export function getTheme(mode: ThemeMode): ThemeColors {
  return mode === 'dark' ? darkTheme : lightTheme
}

/**
 * Apply UI theme colors as CSS custom properties on the given element.
 */
export function applyThemeCssVars(element: HTMLElement, theme: ThemeColors): void {
  const vars: Record<string, string> = {
    '--bg-app': theme.bgApp,
    '--bg-toolbar': theme.bgToolbar,
    '--bg-panel': theme.bgPanel,
    '--bg-dialog': theme.bgDialog,
    '--bg-button': theme.bgButton,
    '--bg-button-hover': theme.bgButtonHover,
    '--bg-button-active': theme.bgButtonActive,
    '--bg-input': theme.bgInput,
    '--border': theme.border,
    '--border-input': theme.borderInput,
    '--text-primary': theme.textPrimary,
    '--text-bright': theme.textBright,
    '--text-muted': theme.textMuted,
    '--text-label': theme.textLabel,
    '--accent': theme.accent,
    '--accent-hover': theme.accentHover,
    '--accent-button': theme.accentButton,
    '--accent-button-hover': theme.accentButtonHover,
    '--error': theme.error,
    '--warning': theme.warning,
    '--success': theme.success,
  }
  for (const [key, value] of Object.entries(vars)) {
    element.style.setProperty(key, value)
  }
}
```

**Step 2: Verify file was created**

Run: `ls src/themes/index.ts`
Expected: file listed

**Step 3: Commit**

```bash
git add src/themes/index.ts
git commit -m "feat: add theme definition with dark/light Fusion 360 color palettes"
```

---

### Task 2: Add Theme State to Zustand Store

**Files:**
- Modify: `src/store/viewerStore.ts`

**Step 1: Add theme imports and state**

Add import at top of file:

```typescript
import type { ThemeMode } from '../themes'
```

Add to the `ViewerState` interface (after `settingsOpen: boolean`):

```typescript
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
```

Add to the `create` initial state (after `settingsOpen: false`):

```typescript
  theme: 'dark' as ThemeMode,
  setTheme: (theme) => set({ theme }),
  toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
```

**Step 2: Verify it compiles**

Run: `cd /home/mark/Code/forge-view && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors related to theme

**Step 3: Commit**

```bash
git add src/store/viewerStore.ts
git commit -m "feat: add theme state to Zustand store"
```

---

### Task 3: Add Theme to Settings Persistence

**Files:**
- Modify: `src/hooks/useSettings.ts`

**Step 1: Update SettingsFile type and persistence logic**

Add to the `SettingsFile` interface:

```typescript
interface SettingsFile {
  performance: {
    preset: QualityPreset
    overrides: PerformanceOverrides
  }
  theme?: ThemeMode
}
```

Add import:

```typescript
import type { ThemeMode } from '../themes'
```

In `loadSettings` handler inside `useSettingsPersistence` (the `.then` callback), add after the performance block:

```typescript
        if (data?.theme) {
          store.setTheme(data.theme)
        }
```

In the save effect, update the `saveSettings` call to include theme. Change the dependency array and save call:

```typescript
  const theme = useViewerStore((s) => s.theme)
```

(Add this line near the other subscriptions at top of the hook.)

Update the save effect deps from `[preset, overrides]` to `[preset, overrides, theme]` and the save call to:

```typescript
      saveSettings({ performance: { preset, overrides }, theme })
```

**Step 2: Verify it compiles**

Run: `cd /home/mark/Code/forge-view && npx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add src/hooks/useSettings.ts
git commit -m "feat: persist theme preference to settings file"
```

---

### Task 4: Add CSS Custom Properties and Apply Theme in App.tsx

**Files:**
- Modify: `src/styles/index.css`
- Modify: `src/App.tsx`

**Step 1: Add CSS variable fallback defaults to index.css**

Replace the contents of `src/styles/index.css` with:

```css
@import "tailwindcss";

/*
 * Theme CSS custom properties — set dynamically by applyThemeCssVars() in App.tsx.
 * Fallback values below match the dark theme so the UI renders correctly
 * before JS hydration.
 */
:root {
  --bg-app: #2D2D2D;
  --bg-toolbar: #383838;
  --bg-panel: #323232;
  --bg-dialog: #3B3B3B;
  --bg-button: #424447;
  --bg-button-hover: #4A4D51;
  --bg-button-active: #354F85;
  --bg-input: #424447;
  --border: #2C2C2C;
  --border-input: #505050;
  --text-primary: #C0C0C6;
  --text-bright: #EEEEEE;
  --text-muted: #777777;
  --text-label: #A5A5AA;
  --accent: #0696D7;
  --accent-hover: #42B6DF;
  --accent-button: #354F85;
  --accent-button-hover: #3D5A96;
  --error: #EB5555;
  --warning: #FBB549;
  --success: #669653;
  color-scheme: dark;
}
```

**Step 2: Update App.tsx to apply theme CSS variables**

Add imports:

```typescript
import { useEffect } from 'react'
import { getTheme, applyThemeCssVars } from './themes'
```

(Note: `useRef` is already imported — just add `useEffect` to the existing import.)

Add inside the `App` component, before the return:

```typescript
  const theme = useViewerStore((s) => s.theme)

  useEffect(() => {
    const colors = getTheme(theme)
    applyThemeCssVars(document.documentElement, colors)
    document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
  }, [theme])
```

Update the root div class from:
```
bg-[#1a1a2e] text-gray-100
```
to:
```
bg-[var(--bg-app)] text-[var(--text-primary)]
```

**Step 3: Verify it compiles and dev server runs**

Run: `cd /home/mark/Code/forge-view && npx tsc --noEmit 2>&1 | head -20`

**Step 4: Commit**

```bash
git add src/styles/index.css src/App.tsx
git commit -m "feat: apply theme CSS variables to document root"
```

---

### Task 5: Update Toolbar.tsx with Theme Colors and Theme Toggle Button

**Files:**
- Modify: `src/components/Toolbar.tsx`

**Step 1: Replace all hardcoded Tailwind gray/blue classes with CSS variable references**

Replace the entire Toolbar component with themed version. Key changes:
- Header: `bg-gray-800 border-gray-700` → `bg-[var(--bg-toolbar)] border-[var(--border)]`
- Title text: `text-gray-100` → `text-[var(--text-bright)]`
- Open button: `bg-blue-600 hover:bg-blue-500` → `bg-[var(--accent-button)] hover:bg-[var(--accent-button-hover)]`
- Open Folder button: `bg-gray-700 hover:bg-gray-600` → `bg-[var(--bg-button)] hover:bg-[var(--bg-button-hover)]`
- View mode selected: `bg-gray-600 text-white` → `bg-[var(--bg-button-active)] text-[var(--text-bright)]`
- View mode unselected: `bg-gray-700 text-gray-400 hover:text-gray-200` → `bg-[var(--bg-button)] text-[var(--text-muted)] hover:text-[var(--text-primary)]`
- Settings/Details buttons: same pattern as view modes
- Explorer button: `bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-white` → `bg-[var(--bg-button)] hover:bg-[var(--bg-button-hover)] text-[var(--text-muted)] hover:text-[var(--text-bright)]`
- Add button group containers: wrap related buttons (view modes) in a `flex border border-[var(--border)] rounded-sm overflow-hidden` container with no gap, buttons lose individual `rounded` class
- Add vertical separator dividers: `<div className="w-px h-6 bg-[var(--border)] mx-1" />` between button groups

Add theme toggle button (sun/moon SVG icon) to the right side, before settings gear:

```tsx
        {/* Theme toggle */}
        <button
          type="button"
          onClick={() => useViewerStore.getState().toggleTheme()}
          className="px-2 py-1.5 text-sm rounded-sm transition-colors bg-[var(--bg-button)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]"
          title={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
        >
          {theme === 'dark' ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a.5.5 0 01.5.5v2a.5.5 0 01-1 0v-2A.5.5 0 018 1zm0 10a3 3 0 100-6 3 3 0 000 6zm0 1a4 4 0 110-8 4 4 0 010 8zm6.5-3.5a.5.5 0 010 1h-2a.5.5 0 010-1h2zM8 13a.5.5 0 01.5.5v2a.5.5 0 01-1 0v-2A.5.5 0 018 13zM3.5 8.5a.5.5 0 010-1h-2a.5.5 0 010 1h2zm10.657-5.157a.5.5 0 010 .707l-1.414 1.414a.5.5 0 11-.707-.707l1.414-1.414a.5.5 0 01.707 0zm-9.193 9.193a.5.5 0 010 .707L3.55 14.657a.5.5 0 01-.707-.707l1.414-1.414a.5.5 0 01.707 0zm9.193 2.121a.5.5 0 01-.707 0l-1.414-1.414a.5.5 0 01.707-.707l1.414 1.414a.5.5 0 010 .707zM4.464 4.465a.5.5 0 01-.707 0L2.343 3.05a.5.5 0 11.707-.707l1.414 1.414a.5.5 0 010 .708z"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6 .278a.77.77 0 01.08.858 7.2 7.2 0 00-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.79.79 0 01.81.316.73.73 0 01-.031.893A8.35 8.35 0 018.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.75.75 0 016 .278z"/>
            </svg>
          )}
        </button>
```

Add theme subscription at top of component:

```typescript
  const theme = useViewerStore((s) => s.theme)
```

**Step 2: Verify it compiles**

Run: `cd /home/mark/Code/forge-view && npx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add src/components/Toolbar.tsx
git commit -m "feat: theme toolbar with CSS vars, add sun/moon toggle"
```

---

### Task 6: Update Sidebar.tsx with Theme Colors

**Files:**
- Modify: `src/components/Sidebar.tsx`

**Step 1: Replace all hardcoded color classes**

Key replacements:
- `bg-gray-800` → `bg-[var(--bg-panel)]`
- `border-gray-700` → `border-[var(--border)]`
- `text-gray-400` (section headers) → `text-[var(--text-label)]`
- `text-gray-500` (close btn, labels) → `text-[var(--text-muted)]`
- `text-gray-300` (close hover) → `text-[var(--text-primary)]`
- `text-gray-200` (values) → `text-[var(--text-primary)]`
- `text-gray-100` → `text-[var(--text-bright)]`
- `text-red-400` → `text-[var(--error)]`
- `bg-gray-700` (badge) → `bg-[var(--bg-button)]`
- `text-gray-500` (placeholder) → `text-[var(--text-muted)]`
- Resize handle: `bg-blue-500/50` → `bg-[var(--accent)]/50` (keep as `bg-[color-mix(in_srgb,var(--accent)_50%,transparent)]` or just keep `bg-blue-500/50` since accent is blue in both themes)

Note: Keep `bg-blue-500/50` and `bg-blue-500/70` for the resize handle since the accent is blue in both themes — no need to change.

**Step 2: Verify it compiles**

Run: `cd /home/mark/Code/forge-view && npx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: theme sidebar with CSS vars"
```

---

### Task 7: Update SettingsModal.tsx — Theme Colors + Appearance Section

**Files:**
- Modify: `src/components/SettingsModal.tsx`

**Step 1: Replace all hardcoded color classes in modal**

Key replacements:
- `bg-gray-800` → `bg-[var(--bg-dialog)]`
- `border-gray-700` → `border-[var(--border)]`
- `text-gray-100` → `text-[var(--text-bright)]`
- `text-gray-400` (close, labels) → `text-[var(--text-label)]`
- `text-gray-200` (close hover) → `text-[var(--text-primary)]`
- `text-gray-300` (toggle labels, select text) → `text-[var(--text-primary)]`
- `bg-blue-600` (selected preset, toggle on) → `bg-[var(--accent-button)]` for presets, `bg-[var(--accent)]` for toggles
- `bg-gray-700` (unselected preset) → `bg-[var(--bg-button)]`
- `bg-gray-600` (toggle off, select hover) → `bg-[var(--bg-button)]`
- `bg-gray-700` (select input) → `bg-[var(--bg-input)]`
- `border-gray-600` (select border) → `border-[var(--border-input)]`
- `text-gray-200` (select text) → `text-[var(--text-primary)]`
- Footer: `text-gray-400 hover:text-gray-200` → `text-[var(--text-muted)] hover:text-[var(--text-primary)]`
- Done button: `bg-blue-600 hover:bg-blue-500` → `bg-[var(--accent-button)] hover:bg-[var(--accent-button-hover)]`
- `bg-white` (toggle knob) stays white in both themes

Update the `Select` component's `style` prop: change `colorScheme: 'dark'` to use the theme. The simplest way is to remove the inline style and let the document-level `color-scheme` handle it (set in App.tsx effect).

**Step 2: Add Appearance section with theme toggle**

Add at the very top of the modal body (before "Quality Preset"), add theme subscription and an Appearance section:

```tsx
  const theme = useViewerStore((s) => s.theme)
```

Then in the body JSX, before the Quality Preset div:

```tsx
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
                        ? 'bg-[var(--accent-button)] text-[var(--text-bright)]'
                        : 'bg-[var(--bg-button)] text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]',
                    ].join(' ')}
                  >
                    {t === 'dark' ? 'Dark' : 'Light'}
                  </button>
                ))}
              </div>
            </div>
```

**Step 3: Also update the inner Toggle and Select components to use CSS vars**

Toggle `text-gray-300` label → `text-[var(--text-primary)]`
Toggle on: `bg-blue-600` → `bg-[var(--accent)]`
Toggle off: `bg-gray-600` → `bg-[var(--bg-button)]`

Select label: `text-gray-300` → `text-[var(--text-primary)]`
Select input: `bg-gray-700 text-gray-200 border-gray-600` → `bg-[var(--bg-input)] text-[var(--text-primary)] border-[var(--border-input)]`

**Step 4: Verify it compiles**

Run: `cd /home/mark/Code/forge-view && npx tsc --noEmit 2>&1 | head -20`

**Step 5: Commit**

```bash
git add src/components/SettingsModal.tsx
git commit -m "feat: theme settings modal, add Appearance section"
```

---

### Task 8: Update DropZone.tsx with Theme Colors

**Files:**
- Modify: `src/components/DropZone.tsx`

**Step 1: Replace hardcoded colors**

- `bg-[#1a1a2e]` → `bg-[var(--bg-app)]`
- `text-gray-600` (icon) → `text-[var(--text-muted)]`
- `text-gray-300` (title) → `text-[var(--text-primary)]`
- `text-gray-500` (subtitle) → `text-[var(--text-muted)]`
- `bg-blue-600 hover:bg-blue-500` (button) → `bg-[var(--accent-button)] hover:bg-[var(--accent-button-hover)]`
- `ring-blue-500` → keep as-is (accent is blue both themes)

**Step 2: Verify it compiles**

Run: `cd /home/mark/Code/forge-view && npx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add src/components/DropZone.tsx
git commit -m "feat: theme drop zone with CSS vars"
```

---

### Task 9: Update DirectoryPanel.tsx with Theme Colors

**Files:**
- Modify: `src/components/DirectoryPanel.tsx`

**Step 1: Replace hardcoded colors**

Panel level:
- `bg-gray-800` → `bg-[var(--bg-panel)]`

Header:
- `text-gray-400` (title) → `text-[var(--text-label)]`
- `text-gray-500 hover:text-gray-300` (close) → `text-[var(--text-muted)] hover:text-[var(--text-primary)]`
- `text-gray-500` (path, empty state) → `text-[var(--text-muted)]`

TreeNode:
- `bg-blue-700/50 text-white` (active) → `bg-[var(--accent-button)]/50 text-[var(--text-bright)]` — use Tailwind opacity: `bg-[var(--bg-button-active)] text-[var(--text-bright)]` with an opacity modifier. Simplest: keep `bg-blue-700/50` since accent is blue both themes, but change text to `text-[var(--text-bright)]`.
- `text-gray-300 hover:bg-gray-700/50` (inactive) → `text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]/50`
- `text-gray-500` (chevron, file size) → `text-[var(--text-muted)]`
- `bg-gray-600` (format badge) → `bg-[var(--bg-button)]`
- `text-yellow-500` (folder icon) → keep as-is (semantic)
- `text-red-400 hover:text-red-300 hover:bg-gray-600` (remove btn) → `text-[var(--error)] hover:bg-[var(--bg-button)]`
- `text-gray-400 hover:text-blue-400 hover:bg-gray-600` (add btn) → `text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-button)]`

Resize handle: keep `bg-blue-500/50` and `bg-blue-500/70` (accent blue both themes).

**Step 2: Verify it compiles**

Run: `cd /home/mark/Code/forge-view && npx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add src/components/DirectoryPanel.tsx
git commit -m "feat: theme directory panel with CSS vars"
```

---

### Task 10: Update ModelList.tsx with Theme Colors

**Files:**
- Modify: `src/components/ModelList.tsx`

**Step 1: Replace hardcoded colors**

- `text-gray-500` (empty state) → `text-[var(--text-muted)]`
- `text-gray-300 hover:bg-gray-700` (model item) → `text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]`
- `bg-gray-600` (format badge) → `bg-[var(--bg-button)]`
- `text-gray-400` (triangle count) → `text-[var(--text-muted)]`
- `text-gray-500 hover:text-red-400` (remove btn) → `text-[var(--text-muted)] hover:text-[var(--error)]`
- `text-gray-300 hover:text-red-400` (clear all) → `text-[var(--text-primary)] hover:text-[var(--error)]`

**Step 2: Verify it compiles**

Run: `cd /home/mark/Code/forge-view && npx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add src/components/ModelList.tsx
git commit -m "feat: theme model list with CSS vars"
```

---

### Task 11: Update SceneControls.tsx with Theme Colors

**Files:**
- Modify: `src/components/SceneControls.tsx`

**Step 1: Replace hardcoded colors in IconButton and container**

Container:
- `bg-gray-900/60` → `bg-[var(--bg-panel)]/60` — but CSS var with Tailwind opacity can be tricky. Use inline style or `background: color-mix(...)`. Simplest: use `bg-[var(--bg-panel)]` with `opacity-60` won't work (affects children). Best approach: keep `bg-gray-900/60` for dark and handle via a themed class. Actually simplest: use the CSS var with rgba. Since the panel bg is a hex, use: `style={{ backgroundColor: 'color-mix(in srgb, var(--bg-panel) 60%, transparent)' }}` alongside `backdrop-blur-sm rounded-lg p-1.5`.

Actually the cleanest approach: just use `bg-[var(--bg-button)]/80` — Tailwind v4 supports opacity modifiers on arbitrary values. Test this. If it doesn't work with CSS vars, fall back to inline style.

IconButton:
- Active: `bg-blue-600/80 text-white` → `bg-[var(--accent)]/80 text-[var(--text-bright)]` — again accent is blue both themes, so can keep `bg-blue-600/80`. Change text: `text-[var(--text-bright)]`
- Inactive: `bg-gray-800/80 text-gray-300 hover:bg-gray-700/90 hover:text-white` → `bg-[var(--bg-button)]/80 text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]/90 hover:text-[var(--text-bright)]`

Divider:
- `bg-gray-600/50` → `bg-[var(--border)]`

Note: Tailwind v4 CSS-first may not support `/opacity` on `var()` values. If compilation fails, use inline styles for the opacity backgrounds. A safer pattern:

```tsx
style={{ backgroundColor: `color-mix(in srgb, var(--bg-button) 80%, transparent)` }}
```

**Step 2: Verify it compiles**

Run: `cd /home/mark/Code/forge-view && npx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add src/components/SceneControls.tsx
git commit -m "feat: theme scene controls with CSS vars"
```

---

### Task 12: Update App.tsx Remaining Hardcoded Colors

**Files:**
- Modify: `src/App.tsx`

**Step 1: Replace remaining hardcoded colors in App.tsx**

Loading overlay:
- `border-gray-600 border-t-blue-400` → `border-[var(--border)] border-t-[var(--accent)]`
- `text-gray-200` → `text-[var(--text-primary)]`

Error bar:
- `bg-red-900/90 text-red-100` → keep red for errors — this is semantic. But adapt slightly: `bg-[var(--error)]/15 text-[var(--error)]` or keep the current red scheme since errors should always look alarming. Best: keep `bg-red-900/90 text-red-100` — it works well on both dark and light, and the error bar is an overlay on the viewport, not on chrome. Actually on light theme `bg-red-900/90` will look very dark and fine. Keep as-is.
- `text-red-300 hover:text-white` (dismiss) → keep as-is

Actually, reconsider: on light theme a dark red bar might look jarring. Better approach: use the CSS var for a subtler theme-aware error:
- `bg-[var(--error)]` with low opacity: `bg-[var(--error)]/10` won't be visible enough.
- Best: keep `bg-red-900/90 text-red-100` — it's an overlay notification meant to grab attention, works on any background.

**Step 2: Verify it compiles**

Run: `cd /home/mark/Code/forge-view && npx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: theme remaining App.tsx hardcoded colors"
```

---

### Task 13: Add Theme-Aware Scene Colors to Viewer3D.tsx

**Files:**
- Modify: `src/components/Viewer3D.tsx`

This is the most critical task — updating the Three.js scene to react to theme changes.

**Step 1: Add theme subscription and scene update effect**

Add import at top:

```typescript
import { getTheme } from '../themes'
```

Add theme subscription inside the component (after the other store subscriptions):

```typescript
  const theme = useViewerStore((s) => s.theme)
```

Add a new Effect (after Effect 7) — **Effect 8: Theme-aware scene colors**:

```typescript
  // Effect 8: Theme — update scene background, grid, lights, and model materials
  useEffect(() => {
    const colors = getTheme(theme)

    // Scene background gradient (top→bottom via two-color linear gradient on a plane,
    // or simpler: use Three.js background array for top/bottom)
    // Three.js doesn't natively support gradient backgrounds, so we create a simple
    // vertical gradient texture.
    if (sceneRef.current) {
      const canvas = document.createElement('canvas')
      canvas.width = 2
      canvas.height = 256
      const ctx = canvas.getContext('2d')!
      const topColor = new THREE.Color(colors.sceneBgTop)
      const bottomColor = new THREE.Color(colors.sceneBgBottom)
      const gradient = ctx.createLinearGradient(0, 0, 0, 256)
      gradient.addColorStop(0, `#${topColor.getHexString()}`)
      gradient.addColorStop(1, `#${bottomColor.getHexString()}`)
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, 2, 256)
      const texture = new THREE.CanvasTexture(canvas)
      texture.needsUpdate = true

      // Dispose old background texture if it exists
      if (sceneRef.current.background instanceof THREE.Texture) {
        sceneRef.current.background.dispose()
      }
      sceneRef.current.background = texture
    }

    // Grid colors
    if (gridRef.current && sceneRef.current) {
      const oldGrid = gridRef.current
      const pos = oldGrid.position.clone()
      const args = (oldGrid.geometry as any).parameters
      const gridSize = args?.width ?? 200
      const divs = (oldGrid as any)._divisions ?? 20
      sceneRef.current.remove(oldGrid)
      oldGrid.dispose()
      const newGrid = new THREE.GridHelper(gridSize, divs, colors.gridPrimary, colors.gridSecondary)
      ;(newGrid as any)._divisions = divs
      newGrid.position.copy(pos)
      sceneRef.current.add(newGrid)
      gridRef.current = newGrid
    }

    // Lighting
    const lights = lightsRef.current
    if (lights.length >= 2) {
      const hemi = lights[0] as THREE.HemisphereLight
      hemi.color.setHex(colors.hemisphereSky)
      hemi.groundColor.setHex(colors.hemisphereGround)
      const key = lights[1] as THREE.DirectionalLight
      key.intensity = colors.keyLightIntensity
      if (lights.length >= 3) {
        const fill = lights[2] as THREE.DirectionalLight
        fill.intensity = colors.fillLightIntensity
      }
    }

    // Model material color — update existing loaded models
    const updateMaterial = (obj: THREE.Object3D) => {
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const materials = Array.isArray(child.material) ? child.material : [child.material]
          for (const mat of materials) {
            if (mat && 'color' in mat && mat.color instanceof THREE.Color) {
              // Only update default gray materials (not textured/colored models like GLTF)
              const hex = mat.color.getHex()
              // Check if it's one of our default grays (0xB0B0B0 or 0x909090)
              if (hex === 0xB0B0B0 || hex === 0x909090) {
                mat.color.setHex(colors.modelColor)
              }
            }
          }
        }
      })
    }

    if (modelGroupRef.current) {
      updateMaterial(modelGroupRef.current)
    }
    for (const obj of modelMapRef.current.values()) {
      updateMaterial(obj)
    }
  }, [theme])
```

**Step 2: Update Effect 1 (renderer init) to use theme for initial colors**

In Effect 1, change the scene background from hardcoded to use theme:

Replace:
```typescript
    scene.background = new THREE.Color(0x1a1a2e)
```
With:
```typescript
    // Initial background — will be replaced by theme effect
    scene.background = new THREE.Color(0x2D2D2D)
```

(The theme effect will immediately override this with the gradient, so this is just a flash-prevention default.)

**Step 3: Update Effect 2 (model loading) to use theme-aware model color**

In `src/loaders/index.ts`, the default model material color is hardcoded to `0xb0b0b0`. We need to pass the theme color when loading. The cleanest approach: after loading the model in Effect 2 (line 241-246), apply the theme's model color. After the `.then((obj) => {` block, where `applyViewMode` is called, add:

```typescript
        // Apply theme-aware model color
        const themeColors = getTheme(useViewerStore.getState().theme)
        obj.traverse((child: THREE.Object3D) => {
          if (child instanceof THREE.Mesh) {
            const mats = Array.isArray(child.material) ? child.material : [child.material]
            for (const mat of mats) {
              if (mat && 'color' in mat && mat.color instanceof THREE.Color) {
                if (mat.color.getHex() === 0xB0B0B0) {
                  mat.color.setHex(themeColors.modelColor)
                }
              }
            }
          }
        })
```

Do the same in Effect 5 (multi-model load), after the `applyViewMode` call in the `.then` handler around line 370.

**Step 4: Update the grid creation in Effects 2 and 5 to use theme colors**

In Effect 2, where a new grid is created (around line 272), replace:
```typescript
          const newGrid = new THREE.GridHelper(gridSize, gridDivisions, 0x444466, 0x333355)
```
With:
```typescript
          const themeGrid = getTheme(useViewerStore.getState().theme)
          const newGrid = new THREE.GridHelper(gridSize, gridDivisions, themeGrid.gridPrimary, themeGrid.gridSecondary)
```

Do the same in Effect 5 (around line 411) where the union grid is created.

**Step 5: Verify it compiles**

Run: `cd /home/mark/Code/forge-view && npx tsc --noEmit 2>&1 | head -20`

**Step 6: Commit**

```bash
git add src/components/Viewer3D.tsx
git commit -m "feat: theme-aware scene background gradient, grid, lighting, and model materials"
```

---

### Task 14: Visual Testing and Polish

**Files:**
- No new files — this is a testing/verification task

**Step 1: Start dev server**

Run: `cd /home/mark/Code/forge-view && pnpm tauri dev`

**Step 2: Manual verification checklist**

Test in the running app:

1. App starts in dark theme — verify all UI chrome matches Fusion 360 dark colors
2. Click sun icon in toolbar — verify instant switch to light theme:
   - Toolbar becomes light gray
   - Sidebar becomes light
   - Settings modal (open it) becomes white
   - DropZone (clear models first) becomes light
   - Viewport background becomes gray gradient
   - Grid lines become lighter
3. Load a model (STL) — verify:
   - Dark theme: model is light gray (#B0B0B0)
   - Light theme: model is darker gray (#909090)
   - Lighting looks correct in both themes
4. Open Settings modal — verify Appearance section shows Dark/Light toggle
5. Switch theme from Settings — verify it works same as toolbar button
6. Close and reopen app — verify theme persists
7. Open a folder — verify DirectoryPanel colors are correct in both themes
8. Check SceneControls overlay buttons in both themes

**Step 3: Fix any visual issues found**

Address any color mismatches, missing variable references, or contrast issues discovered during testing.

**Step 4: Final commit if any fixes were made**

```bash
git add -A
git commit -m "fix: polish theme colors after visual testing"
```

---

## Task Dependency Order

```
Task 1 (theme definition)
  → Task 2 (store state)
    → Task 3 (persistence)
    → Task 4 (CSS vars + App.tsx)
      → Tasks 5-12 (component updates — can be done in parallel)
        → Task 13 (Viewer3D scene colors)
          → Task 14 (visual testing)
```

Tasks 5 through 12 are independent of each other and can be done in any order or in parallel, but they all depend on Task 4 (CSS variables being applied).
