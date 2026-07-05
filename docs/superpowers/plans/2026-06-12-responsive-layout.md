# Responsive Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app layout usable on phones and narrow windows without changing the desktop layout.

**Architecture:** A Tailwind `md` (768px) breakpoint splits behavior. At `>= md` everything is unchanged. At `< md` the two side panels render as off-canvas overlay drawers (driven by a new `mobileDrawer` store field), the toolbar collapses to a hamburger + overflow menu + details toggle, and the root uses `100dvh`. Panels render two CSS-gated instances (desktop in-flow, mobile in a drawer) selected by a new `mobile` prop.

**Tech Stack:** React 19, TypeScript, Zustand 5, Tailwind v4, Vitest + Testing Library.

---

## File structure

New:
- `src/components/MobileDrawer.tsx` - presentational slide-in drawer (scrim + fixed sliding panel, `md:hidden`). Test: `src/components/MobileDrawer.test.tsx`.
- `src/components/Toolbar.test.tsx` - tests for the new mobile toolbar row.

Modified:
- `src/store/viewerStore.ts` - add `mobileDrawer` + `setMobileDrawer`. Test: `src/store/viewerStore.test.ts`.
- `src/components/DirectoryPanel.tsx` - add `mobile?: boolean` prop. Test: `src/components/DirectoryPanel.test.tsx`.
- `src/components/Sidebar.tsx` - add `mobile?: boolean` prop. Test: `src/components/Sidebar.test.tsx` (new).
- `src/components/Toolbar.tsx` - desktop row `hidden md:flex`; new mobile row.
- `src/App.tsx` - `h-[100dvh]`; render desktop panels + mobile drawers.

---

## Task 1: Store field `mobileDrawer`

**Files:**
- Modify: `src/store/viewerStore.ts`
- Test: `src/store/viewerStore.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the top-level `describe` of `src/store/viewerStore.test.ts`:

```ts
describe('mobileDrawer', () => {
  beforeEach(() => {
    useViewerStore.setState({ mobileDrawer: 'none' })
  })

  it('defaults to none', () => {
    expect(useViewerStore.getState().mobileDrawer).toBe('none')
  })

  it('setMobileDrawer sets the value', () => {
    useViewerStore.getState().setMobileDrawer('explorer')
    expect(useViewerStore.getState().mobileDrawer).toBe('explorer')
  })

  it('opening one drawer replaces the other', () => {
    useViewerStore.getState().setMobileDrawer('explorer')
    useViewerStore.getState().setMobileDrawer('details')
    expect(useViewerStore.getState().mobileDrawer).toBe('details')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/store/viewerStore.test.ts`
Expected: FAIL (`setMobileDrawer is not a function`).

- [ ] **Step 3: Implement**

In `src/store/viewerStore.ts`, add to the `ViewerState` interface (near `mainView`):

```ts
  mobileDrawer: 'none' | 'explorer' | 'details'
  setMobileDrawer: (d: 'none' | 'explorer' | 'details') => void
```

Add to initial state (near `mainView: 'grid',`):

```ts
  mobileDrawer: 'none',
```

Add the setter (near `setMainView`):

```ts
  setMobileDrawer: (d) => set({ mobileDrawer: d }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/store/viewerStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/viewerStore.ts src/store/viewerStore.test.ts
git commit -m "feat: add mobileDrawer store state"
```

---

## Task 2: MobileDrawer component

**Files:**
- Create: `src/components/MobileDrawer.tsx`
- Test: `src/components/MobileDrawer.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/MobileDrawer.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MobileDrawer } from './MobileDrawer'

describe('MobileDrawer', () => {
  it('renders its children', () => {
    render(<MobileDrawer side="left" open onClose={() => {}}><p>panel body</p></MobileDrawer>)
    expect(screen.getByText('panel body')).toBeTruthy()
  })

  it('shows a scrim only when open', () => {
    const { rerender } = render(
      <MobileDrawer side="left" open={false} onClose={() => {}}><p>x</p></MobileDrawer>
    )
    expect(screen.queryByTestId('drawer-scrim')).toBeNull()
    rerender(<MobileDrawer side="left" open onClose={() => {}}><p>x</p></MobileDrawer>)
    expect(screen.getByTestId('drawer-scrim')).toBeTruthy()
  })

  it('clicking the scrim calls onClose', async () => {
    const onClose = vi.fn()
    render(<MobileDrawer side="left" open onClose={onClose}><p>x</p></MobileDrawer>)
    await userEvent.click(screen.getByTestId('drawer-scrim'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('applies the off-screen translate class when closed', () => {
    render(<MobileDrawer side="right" open={false} onClose={() => {}}><p>x</p></MobileDrawer>)
    expect(screen.getByTestId('drawer-panel').className).toContain('translate-x-full')
  })

  it('applies the on-screen translate class when open', () => {
    render(<MobileDrawer side="right" open onClose={() => {}}><p>x</p></MobileDrawer>)
    expect(screen.getByTestId('drawer-panel').className).toContain('translate-x-0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/components/MobileDrawer.test.tsx`
Expected: FAIL (`MobileDrawer` not found).

- [ ] **Step 3: Implement**

Create `src/components/MobileDrawer.tsx`:

```tsx
import type { ReactNode } from 'react'

interface MobileDrawerProps {
  side: 'left' | 'right'
  open: boolean
  onClose: () => void
  children: ReactNode
}

/**
 * Mobile-only (`md:hidden`) off-canvas drawer: a scrim plus a fixed panel that
 * slides in from the given side. Desktop renders panels in-flow instead, so
 * this whole component is hidden at `>= md`.
 */
export function MobileDrawer({ side, open, onClose, children }: MobileDrawerProps) {
  const offscreen = side === 'left' ? '-translate-x-full' : 'translate-x-full'
  return (
    <div className="md:hidden">
      {open && (
        <div
          data-testid="drawer-scrim"
          onClick={onClose}
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-[var(--scrim)]"
        />
      )}
      <div
        data-testid="drawer-panel"
        className={[
          'fixed inset-y-0 z-40 w-[80vw] max-w-xs bg-[var(--bg-panel)] overflow-hidden transition-transform',
          side === 'left' ? 'left-0' : 'right-0',
          open ? 'translate-x-0' : offscreen,
        ].join(' ')}
      >
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/components/MobileDrawer.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/MobileDrawer.tsx src/components/MobileDrawer.test.tsx
git commit -m "feat: MobileDrawer slide-in component"
```

---

## Task 3: DirectoryPanel `mobile` prop

**Files:**
- Modify: `src/components/DirectoryPanel.tsx`
- Test: `src/components/DirectoryPanel.test.tsx`

Current `DirectoryPanel()` (line ~164): reads store, has a resize handle, early-returns `if (dirPath === null || !explorerVisible) return null`, root `<aside className="relative bg-[var(--bg-panel)] flex flex-col shrink-0 overflow-hidden" style={{ width }}>`, close button calls `setExplorerVisible(false)`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/DirectoryPanel.test.tsx` (it already mocks the store and renders the panel; add a new describe). Use the existing import of `useViewerStore` and React Testing Library helpers already in that file:

```tsx
describe('DirectoryPanel mobile variant', () => {
  beforeEach(() => {
    useViewerStore.setState({
      dirPath: '/m', dirTree: [], explorerVisible: false, mobileDrawer: 'explorer',
    })
  })

  it('renders when dirPath is set even though explorerVisible is false', () => {
    render(<DirectoryPanel mobile />)
    expect(screen.getByText('Explorer')).toBeTruthy()
  })

  it('close button clears the mobile drawer, not explorerVisible', async () => {
    render(<DirectoryPanel mobile />)
    await userEvent.click(screen.getByRole('button', { name: /close explorer/i }))
    expect(useViewerStore.getState().mobileDrawer).toBe('none')
    expect(useViewerStore.getState().explorerVisible).toBe(false)
  })
})
```

Ensure the test file imports `userEvent` (`import userEvent from '@testing-library/user-event'`) and `screen`, `render` from `@testing-library/react`; add the import if missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/components/DirectoryPanel.test.tsx`
Expected: FAIL (`mobile` prop ignored: with `explorerVisible:false` the panel early-returns null, so "Explorer" is absent).

- [ ] **Step 3: Implement**

In `src/components/DirectoryPanel.tsx`, change the function signature:

```tsx
export function DirectoryPanel({ mobile = false }: { mobile?: boolean } = {}) {
```

Replace the early-return line:

```tsx
  if (dirPath === null || !explorerVisible) return null
```

with:

```tsx
  if (dirPath === null) return null
  if (!mobile && !explorerVisible) return null
```

Add a close handler just before the `return (` (after the `dirName` line):

```tsx
  const close = () =>
    mobile
      ? useViewerStore.getState().setMobileDrawer('none')
      : useViewerStore.getState().setExplorerVisible(false)
```

Change the root `<aside>` to switch classes by `mobile` and drop the fixed width on mobile:

```tsx
    <aside
      className={
        mobile
          ? 'relative bg-[var(--bg-panel)] flex flex-col h-full w-full overflow-hidden'
          : 'relative bg-[var(--bg-panel)] hidden md:flex flex-col shrink-0 overflow-hidden'
      }
      style={mobile ? undefined : { width }}
    >
```

Change the close button's `onClick` from `() => useViewerStore.getState().setExplorerVisible(false)` to `close`.

Wrap the resize handle so it is desktop-only. Change its opening `<div` to include a `mobile` guard by rendering it only when not mobile:

```tsx
      {!mobile && (
        <div
          onMouseDown={handleMouseDown}
          className="absolute top-0 -right-1 w-3 h-full cursor-col-resize z-10 group"
        >
          <div className="absolute top-0 right-1 w-1 h-full group-hover:bg-[var(--accent)]/50 group-active:bg-[var(--accent)]/70 transition-colors" />
        </div>
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/components/DirectoryPanel.test.tsx`
Expected: PASS (existing tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/components/DirectoryPanel.tsx src/components/DirectoryPanel.test.tsx
git commit -m "feat: DirectoryPanel mobile drawer variant"
```

---

## Task 4: Sidebar `mobile` prop

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Test: `src/components/Sidebar.test.tsx` (new)

Current `Sidebar()`: early-returns `if (!sidebarVisible) return <aside className="hidden" />`, root `<aside className="relative bg-[var(--bg-panel)] border-l border-[var(--border)] flex flex-col shrink-0 overflow-y-auto overflow-x-hidden" style={{ width }}>`, a resize handle div, a close button calling `setSidebarVisible(false)`.

- [ ] **Step 1: Write the failing test**

Create `src/components/Sidebar.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'
import { useViewerStore } from '../store/viewerStore'

describe('Sidebar mobile variant', () => {
  beforeEach(() => {
    useViewerStore.setState({
      sidebarVisible: false, mobileDrawer: 'details',
      fileName: null, fileExtension: null, fileSize: null, triangleCount: null,
      isLoading: false, error: null, loadedModels: [], filePath: null,
    })
  })

  it('renders content even though sidebarVisible is false', () => {
    render(<Sidebar mobile />)
    expect(screen.getByText('Scene Models')).toBeTruthy()
  })

  it('close button clears the mobile drawer, not sidebarVisible', async () => {
    render(<Sidebar mobile />)
    await userEvent.click(screen.getByRole('button', { name: /close sidebar/i }))
    expect(useViewerStore.getState().mobileDrawer).toBe('none')
    expect(useViewerStore.getState().sidebarVisible).toBe(false)
  })
})

describe('Sidebar desktop variant', () => {
  beforeEach(() => {
    useViewerStore.setState({ sidebarVisible: false })
  })
  it('renders the hidden placeholder when sidebarVisible is false', () => {
    const { container } = render(<Sidebar />)
    expect(container.querySelector('aside.hidden')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/components/Sidebar.test.tsx`
Expected: FAIL (`mobile` ignored: with `sidebarVisible:false` it returns the hidden placeholder, so "Scene Models" is absent).

- [ ] **Step 3: Implement**

In `src/components/Sidebar.tsx`, change the signature:

```tsx
export function Sidebar({ mobile = false }: { mobile?: boolean } = {}) {
```

Replace the early-return:

```tsx
  if (!sidebarVisible) {
    return <aside className="hidden" />
  }
```

with:

```tsx
  if (!mobile && !sidebarVisible) {
    return <aside className="hidden" />
  }
```

Add a close handler before `return (`:

```tsx
  const close = () =>
    mobile
      ? useViewerStore.getState().setMobileDrawer('none')
      : useViewerStore.getState().setSidebarVisible(false)
```

Change the root `<aside>`:

```tsx
    <aside
      className={
        mobile
          ? 'relative bg-[var(--bg-panel)] flex flex-col h-full w-full overflow-y-auto overflow-x-hidden'
          : 'relative bg-[var(--bg-panel)] border-l border-[var(--border)] hidden md:flex flex-col shrink-0 overflow-y-auto overflow-x-hidden'
      }
      style={mobile ? undefined : { width }}
    >
```

Render the resize handle only when not mobile (wrap the existing handle `<div onMouseDown={handleMouseDown} ...>...</div>` in `{!mobile && ( ... )}`).

Change the close button `onClick` from `() => useViewerStore.getState().setSidebarVisible(false)` to `close`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/components/Sidebar.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/components/Sidebar.test.tsx
git commit -m "feat: Sidebar mobile drawer variant"
```

---

## Task 5: Toolbar mobile row

**Files:**
- Modify: `src/components/Toolbar.tsx`
- Test: `src/components/Toolbar.test.tsx` (new)

Goal: at `< md` show a condensed row; at `>= md` the current row. Both rows exist in the DOM (CSS-gated), so tests scope queries with `data-testid`.

- [ ] **Step 1: Write the failing test**

Create `src/components/Toolbar.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toolbar } from './Toolbar'
import { useViewerStore } from '../store/viewerStore'

vi.mock('../hooks/useFileOpen', () => ({ useFileOpen: () => ({ openFile: vi.fn() }) }))
vi.mock('../hooks/useDirOpen', () => ({ useDirOpen: () => ({ openDir: vi.fn() }) }))

beforeEach(() => {
  useViewerStore.setState({
    viewMode: 'solid', dirPath: '/m', mainView: 'grid',
    explorerVisible: true, sidebarVisible: true, theme: 'dark', mobileDrawer: 'none',
  })
})

const mobile = () => within(screen.getByTestId('toolbar-mobile'))

describe('Toolbar mobile row', () => {
  it('hamburger opens the explorer drawer', async () => {
    render(<Toolbar />)
    await userEvent.click(mobile().getByRole('button', { name: /explorer/i }))
    expect(useViewerStore.getState().mobileDrawer).toBe('explorer')
  })

  it('details button opens the details drawer', async () => {
    render(<Toolbar />)
    await userEvent.click(mobile().getByRole('button', { name: /details/i }))
    expect(useViewerStore.getState().mobileDrawer).toBe('details')
  })

  it('overflow menu opens and a view-mode item updates the store and closes', async () => {
    render(<Toolbar />)
    await userEvent.click(mobile().getByRole('button', { name: /more actions/i }))
    const menu = screen.getByTestId('toolbar-menu')
    await userEvent.click(within(menu).getByRole('button', { name: /^wireframe$/i }))
    expect(useViewerStore.getState().viewMode).toBe('wireframe')
    expect(screen.queryByTestId('toolbar-menu')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/components/Toolbar.test.tsx`
Expected: FAIL (`toolbar-mobile` testid not found).

- [ ] **Step 3: Implement**

In `src/components/Toolbar.tsx`:

Add `useState` import at the top:

```tsx
import { useState } from 'react'
```

Add inside the component body (after the existing hooks, before `handleOpenDir`):

```tsx
  const [menuOpen, setMenuOpen] = useState(false)
  const setMobileDrawer = useViewerStore((s) => s.setMobileDrawer)
  const mobileDrawer = useViewerStore((s) => s.mobileDrawer)
```

Wrap the entire existing content of the `<header>` (everything from the title `<span>` through the closing `</div>` of the right-side group) in a desktop-only container. That is, immediately after the opening `<header ...>` tag insert:

```tsx
      {/* Desktop row */}
      <div data-testid="toolbar-desktop" className="hidden md:flex md:items-center md:gap-3 md:w-full">
```

and immediately before the closing `</header>` insert the matching `</div>` to close it. (All current children now live inside this desktop container.)

Then, directly after the opening `<header ...>` tag and BEFORE the desktop container, add the mobile row:

```tsx
      {/* Mobile row */}
      <div data-testid="toolbar-mobile" className="flex md:hidden items-center gap-2 w-full">
        <button
          type="button"
          onClick={() => setMobileDrawer(mobileDrawer === 'explorer' ? 'none' : 'explorer')}
          aria-label="Toggle Explorer"
          title="Explorer"
          className="min-h-10 px-2 text-[var(--text-primary)] hover:text-[var(--text-bright)]"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
          </svg>
        </button>

        <span className="font-semibold text-[var(--text-bright)]">Forge View</span>

        <div className="ml-auto flex items-center gap-1">
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="More actions"
              title="More actions"
              className="min-h-10 px-3 text-lg leading-none text-[var(--text-primary)] hover:text-[var(--text-bright)]"
            >
              &#8943;
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden="true" />
                <div
                  data-testid="toolbar-menu"
                  className="absolute right-0 top-full mt-1 z-50 min-w-44 rounded border border-[var(--border)] bg-[var(--bg-dialog)] py-1 shadow-[0_10px_40px_var(--shadow-color)]"
                >
                  <button type="button" onClick={() => { setMenuOpen(false); openFile() }} className="block w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]">Open</button>
                  <button type="button" onClick={() => { setMenuOpen(false); handleOpenDir() }} className="block w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]">Open Folder</button>
                  <div className="my-1 border-t border-[var(--border)]" />
                  {VIEW_MODES.map(({ mode, label }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => { setMenuOpen(false); useViewerStore.getState().setViewMode(mode) }}
                      className="block w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]"
                    >
                      {label}
                    </button>
                  ))}
                  {dirPath && (
                    <>
                      <div className="my-1 border-t border-[var(--border)]" />
                      <button type="button" onClick={() => { setMenuOpen(false); useViewerStore.getState().setMainView('grid') }} className="block w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]">Grid</button>
                      <button type="button" onClick={() => { setMenuOpen(false); useViewerStore.getState().setMainView('3d') }} className="block w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]">3D</button>
                    </>
                  )}
                  <div className="my-1 border-t border-[var(--border)]" />
                  <button type="button" onClick={() => { setMenuOpen(false); useViewerStore.getState().toggleTheme() }} className="block w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]">{theme === 'dark' ? 'Light theme' : 'Dark theme'}</button>
                  <button type="button" onClick={() => { setMenuOpen(false); useViewerStore.getState().setSettingsOpen(true) }} className="block w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]">Settings</button>
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMobileDrawer(mobileDrawer === 'details' ? 'none' : 'details')}
            aria-label="Toggle Details"
            title="Details"
            className="min-h-10 px-3 text-sm rounded bg-[var(--bg-button)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            Details
          </button>
        </div>
      </div>
```

Note: `openFile`, `handleOpenDir`, `VIEW_MODES`, `dirPath`, `theme` are already in scope. The desktop row keeps using the same handlers, so there is one source of truth per action.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/components/Toolbar.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify the full suite and types**

Run: `pnpm test && npx tsc --noEmit`
Expected: all pass; tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/Toolbar.tsx src/components/Toolbar.test.tsx
git commit -m "feat: condensed mobile toolbar row with overflow menu"
```

---

## Task 6: App wiring (drawers + dvh)

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add imports and selectors**

In `src/App.tsx`, add import near the other component imports:

```tsx
import { MobileDrawer } from './components/MobileDrawer'
```

Add two selectors with the existing ones:

```tsx
  const mobileDrawer = useViewerStore((s) => s.mobileDrawer)
  const setMobileDrawer = useViewerStore((s) => s.setMobileDrawer)
```

- [ ] **Step 2: Switch root height to dvh**

Change the root div className from:

```tsx
    <div className="flex flex-col h-screen bg-[var(--bg-app)] text-[var(--text-primary)]">
```

to:

```tsx
    <div className="flex flex-col h-[100dvh] bg-[var(--bg-app)] text-[var(--text-primary)]">
```

- [ ] **Step 3: Render mobile drawers**

The existing `<DirectoryPanel />` (line ~40) and `<Sidebar />` (line ~76) stay as the desktop instances (they now self-hide below `md` via their `hidden md:flex` root). Immediately after the closing `</div>` of the main content row's children but still inside `<div className="flex flex-1 overflow-hidden">`, after `<Sidebar />`, add the mobile drawers:

```tsx
        <Sidebar />

        {/* Mobile-only overlay drawers */}
        <MobileDrawer side="left" open={mobileDrawer === 'explorer'} onClose={() => setMobileDrawer('none')}>
          <DirectoryPanel mobile />
        </MobileDrawer>
        <MobileDrawer side="right" open={mobileDrawer === 'details'} onClose={() => setMobileDrawer('none')}>
          <Sidebar mobile />
        </MobileDrawer>
```

- [ ] **Step 4: Verify types, tests, build**

Run: `npx tsc --noEmit && pnpm test && pnpm build`
Expected: tsc exit 0; all tests pass; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire mobile drawers and dvh root height into App"
```

---

## Task 7: Manual verification (phone via LAN)

**Files:** none. CSS breakpoints are not exercised in jsdom.

- [ ] **Step 1: Launch on LAN**

Run: `TAURI_DEV_HOST=$(hostname -I | awk '{print $1}') pnpm tauri dev`
Open `http://<lan-ip>:1420` on a phone (layout only; file loading needs the native window until the web-file-fallback spec lands).

- [ ] **Step 2: Verify**

- Toolbar fits one row: hamburger, title, `⋯`, Details. No horizontal overflow.
- Hamburger slides in the Explorer drawer from the left; scrim behind; tap scrim or the panel "x" closes it.
- Details slides in the right drawer; closes the same way.
- Opening one drawer while the other is open switches (only one shows).
- `⋯` menu opens, lists Open / Open Folder / Solid / Wireframe / Points / Grid / 3D / theme / Settings; tapping one acts and closes the menu; tapping outside closes it.
- Main viewport/grid is full-width; no fixed side panels eating the screen.
- Desktop (wide window) is unchanged: both side panels in-flow, full toolbar, no hamburger.
- Both themes render cleanly; with OS reduce-motion the drawer does not animate.

- [ ] **Step 3: Record result; stop for review.**

---

## Self-review notes

- Spec coverage: breakpoint `md` (all tasks), `mobileDrawer` state (Task 1), MobileDrawer scrim/translate (Task 2), panel `mobile` prop with desktop `hidden md:flex` + mobile early-return/close rules (Tasks 3, 4), toolbar condensed row + overflow menu + hamburger/details toggles (Task 5), App drawers + `h-[100dvh]` (Task 6), manual phone verification (Task 7). All covered.
- Type consistency: `mobileDrawer: 'none' | 'explorer' | 'details'` and `setMobileDrawer` used identically in store, App, Toolbar, and panel close handlers. `mobile?: boolean` prop identical on DirectoryPanel and Sidebar. `MobileDrawer` props (`side`, `open`, `onClose`, `children`) match its usage in App.
- No placeholders: every code step is complete.
- Note: desktop and mobile toolbar rows both render in jsdom; tests scope via `data-testid="toolbar-mobile"` / `toolbar-menu` to avoid duplicate-match ambiguity.
```
