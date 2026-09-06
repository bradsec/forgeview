# SP-H: In-app Feature Help Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Feature guide" modal reachable from the existing Help menu, with one short section per Prepare-panel tool, established as the place every future SP appends its feature blurb.

**Architecture:** New `helpOpen` store flag (mirrors `settingsOpen`). New `HelpModal.tsx` component (same modal shell as `SettingsModal.tsx` - backdrop, `role="dialog" aria-modal`, Escape/Tab-trap, focus restore, `if (!helpOpen) return null`) rendering a static `HELP_SECTIONS` array. A Help-menu `<MenuItem>` opens it; `App.tsx` renders it and adds `helpOpen` to the main content's `inert` expression.

**Tech Stack:** React 19, Zustand 5, Vitest, Playwright, TypeScript, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-06-sph-in-app-help-design.md`

## Global Constraints

- **No new npm dependency.**
- **No jest-dom** in this repo - component tests use vitest/RTL-core assertions (`(el as HTMLButtonElement).disabled`, `getByRole`, `queryByRole`, `.toBeTruthy()` / `.toBeNull()`), never `toBeInTheDocument()` / `toBeDisabled()`.
- **`helpOpen` is UI chrome** - it is NOT added to `setFile` / `setFileFromBuffer` reset lists (same as `settingsOpen`).
- **`HelpModal` shell mirrors `SettingsModal`** exactly: same backdrop classes, same `fixed inset-0 z-50 flex items-center justify-center p-4` wrapper, same Escape + Tab-trap `handleKeyDown`, same `previousFocusRef` restore-on-close effect, same `if (!helpOpen) return null` guard.
- **Content is a plain array** - `const HELP_SECTIONS: { title: string; body: string }[]` at module scope in `HelpModal.tsx`, mapped to `<section><h3>{title}</h3><p>{body}</p></section>`. No markdown, no images.
- **`pnpm test` (full suite) + `pnpm exec tsc --noEmit` pass before every commit.**

---

## Task 1: `helpOpen` store state

**Files:**
- Modify: `src/store/viewerStore.ts`
- Test: `src/store/viewerStore.test.ts` (extend)

**Interfaces:**
- Produces: `helpOpen: boolean` (default `false`), `setHelpOpen(open: boolean): void` on the store.

- [ ] **Step 1: Write the failing test** (append to `viewerStore.test.ts`)

```ts
describe('help modal state', () => {
  beforeEach(() => useViewerStore.setState({ helpOpen: false }))

  it('defaults to closed', () => {
    expect(useViewerStore.getState().helpOpen).toBe(false)
  })

  it('setHelpOpen toggles it', () => {
    useViewerStore.getState().setHelpOpen(true)
    expect(useViewerStore.getState().helpOpen).toBe(true)
    useViewerStore.getState().setHelpOpen(false)
    expect(useViewerStore.getState().helpOpen).toBe(false)
  })

  it('is not cleared by setFile', () => {
    useViewerStore.getState().setHelpOpen(true)
    useViewerStore.getState().setFile('/m.stl', 'm.stl', '.stl', 1)
    expect(useViewerStore.getState().helpOpen).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/store/viewerStore.test.ts`
Expected: FAIL, `helpOpen` / `setHelpOpen` undefined.

- [ ] **Step 3: Write minimal implementation**

In the `ViewerState` interface, next to `settingsOpen: boolean`:

```ts
  helpOpen: boolean
```

Next to `setSettingsOpen: (open: boolean) => void`:

```ts
  setHelpOpen: (open: boolean) => void
```

In `create()` defaults, next to `settingsOpen: false,`:

```ts
  helpOpen: false,
```

Next to `setSettingsOpen: (open) => set({ settingsOpen: open }),`:

```ts
  setHelpOpen: (open) => set({ helpOpen: open }),
```

Do NOT touch `setFile` / `setFileFromBuffer`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/store/viewerStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/viewerStore.ts src/store/viewerStore.test.ts
git commit -m "feat: helpOpen store flag for the feature guide modal"
```

---

## Task 2: `HelpModal` component

**Files:**
- Create: `src/components/HelpModal.tsx`
- Test: `src/components/HelpModal.test.tsx`

**Interfaces:**
- Consumes: `useViewerStore` `helpOpen` + `setHelpOpen`.
- Produces: `HelpModal()` (no props). Renders `null` when `!helpOpen`; otherwise a `role="dialog" aria-modal="true" aria-labelledby="help-title"` with a heading, the `HELP_SECTIONS` list, and a Close button. Backdrop click, `Escape`, and the Close button all call `setHelpOpen(false)`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HelpModal } from './HelpModal'
import { useViewerStore } from '../store/viewerStore'

describe('HelpModal', () => {
  beforeEach(() => useViewerStore.setState({ helpOpen: false }))

  it('renders nothing when closed', () => {
    render(<HelpModal />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders the guide with a section per tool when open', () => {
    useViewerStore.setState({ helpOpen: true })
    render(<HelpModal />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Repair' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Overhang heatmap' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Measure' })).toBeTruthy()
  })

  it('the Close button closes it', async () => {
    useViewerStore.setState({ helpOpen: true })
    render(<HelpModal />)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(useViewerStore.getState().helpOpen).toBe(false)
  })

  it('Escape closes it', async () => {
    useViewerStore.setState({ helpOpen: true })
    render(<HelpModal />)
    await userEvent.keyboard('{Escape}')
    expect(useViewerStore.getState().helpOpen).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/HelpModal.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { useEffect, useRef } from 'react'
import { useViewerStore } from '../store/viewerStore'

const HELP_SECTIONS: { title: string; body: string }[] = [
  {
    title: 'Readiness checks',
    body: 'The card at the top of the Prepare panel runs each check against the open model and shows pass, warn, or needs-fix. Rows with a Fix button open the tool that resolves them.',
  },
  {
    title: 'Repair',
    body: 'Fills the model into one sealed solid, or runs individual stages: weld vertices, drop bad faces, unify normals, remove small shells, fill holes. "Fill a single hole" lets you pick one open loop in the viewport.',
  },
  {
    title: 'Split into parts',
    body: 'Separates a multi-body model into individually named, toggleable, separately exportable parts. Undo recombines them.',
  },
  {
    title: 'Measure',
    body: 'Click two points on the model to read the straight-line distance in the current display unit.',
  },
  {
    title: 'Scale',
    body: 'Resize the model so one dimension hits a target length, or so the whole model fits a configured build volume.',
  },
  {
    title: 'Transform',
    body: 'Nudge the model by an offset, angle, or per-axis factor; mirror it; drop it to the floor; or center it on the plate. Each is one undoable step.',
  },
  {
    title: 'Overhang heatmap',
    body: 'Highlights faces that point steeply downward past the overhang angle, the surfaces that would need print supports. The Overhangs readiness row uses the same threshold.',
  },
]

export function HelpModal() {
  const helpOpen = useViewerStore((s) => s.helpOpen)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const close = () => useViewerStore.getState().setHelpOpen(false)

  useEffect(() => {
    if (!helpOpen) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    closeButtonRef.current?.focus()
    return () => previousFocusRef.current?.focus()
  }, [helpOpen])

  if (!helpOpen) return null

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
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

  return (
    <>
      <div className="fixed inset-0 bg-[var(--scrim)] z-40" onClick={close} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
          onKeyDown={handleKeyDown}
          className="bg-[var(--bg-dialog)] border border-[var(--border)] rounded shadow-[0_10px_40px_var(--shadow-color)] w-full max-w-lg max-h-[85vh] flex flex-col"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
            <h2 id="help-title" className="text-base font-semibold text-[var(--text-bright)]">Feature guide</h2>
            <button
              type="button"
              ref={closeButtonRef}
              onClick={close}
              aria-label="Close"
              className="text-[var(--text-label)] hover:text-[var(--text-primary)] text-lg leading-none"
            >
              &times;
            </button>
          </div>
          <div className="px-5 py-4 overflow-y-auto flex flex-col gap-4">
            {HELP_SECTIONS.map((s) => (
              <section key={s.title}>
                <h3 className="text-sm font-semibold text-[var(--text-bright)]">{s.title}</h3>
                <p className="mt-1 text-sm text-[var(--text-primary)]">{s.body}</p>
              </section>
            ))}
          </div>
          <div className="px-5 py-4 border-t border-[var(--border)] flex justify-end">
            <button
              type="button"
              onClick={close}
              className="px-3 py-1.5 rounded bg-[var(--bg-button)] text-sm"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
```

Note: the header has an `aria-label="Close"` icon button AND a footer text
"Close" button. The test's `getByRole('button', { name: 'Close' })` must
resolve to exactly one - so give the footer button the accessible name
"Close" (its text) and the header button a DIFFERENT accessible name.
Change the header icon button's `aria-label` to `"Close feature guide"` so
`getByRole('button', { name: 'Close' })` is unambiguous.

- [ ] **Step 3b: apply the disambiguation**

In the code above, set the header icon button to
`aria-label="Close feature guide"` (not `"Close"`). Keep the footer button
text as `Close`. Keep `closeButtonRef` on the header icon button (it is the
first focusable, matching `SettingsModal`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/HelpModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/HelpModal.tsx src/components/HelpModal.test.tsx
git commit -m "feat: HelpModal - feature guide dialog with one section per Prepare tool"
```

---

## Task 3: Help-menu entry

**Files:**
- Modify: `src/components/Toolbar.tsx`
- Test: `src/components/Toolbar.test.tsx` (extend)

**Interfaces:**
- Produces: a "Feature guide" `<MenuItem>` in the Help menu, above "About Forgeview", that closes the menu and calls `setHelpOpen(true)`.

- [ ] **Step 1: Write the failing test**

Read `src/components/Toolbar.test.tsx` first to match its render + menu-open
idiom (it already exercises menus). Add:

```ts
it('the Help menu opens the feature guide', async () => {
  render(<Toolbar />)
  await userEvent.click(screen.getByRole('button', { name: 'Help' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Feature guide' }))
  expect(useViewerStore.getState().helpOpen).toBe(true)
})
```

(Adjust the imports / `render` wrapper / store reset to match the file's
existing tests exactly.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/Toolbar.test.tsx`
Expected: FAIL, no "Feature guide" menuitem.

- [ ] **Step 3: Write minimal implementation**

In `Toolbar.tsx`'s `<Menu label="Help">` block, before the "About
Forgeview" `<MenuItem>`:

```tsx
              <MenuItem onClick={() => { close(); useViewerStore.getState().setHelpOpen(true) }}>Feature guide</MenuItem>
```

(If a `menu-separator` between it and "About Forgeview" reads well with the
existing "File support" heading/note block, add one - match the existing
markup style in that menu.)

- [ ] **Step 4: Run test to verify it passes, then the full suite**

Run: `pnpm test -- src/components/Toolbar.test.tsx`
Expected: PASS.

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no errors, all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Toolbar.tsx src/components/Toolbar.test.tsx
git commit -m "feat: Help menu - Feature guide entry"
```

---

## Task 4: render `HelpModal` + inert wiring

**Files:**
- Modify: `src/App.tsx`

No new test - `App.tsx` has no test file; the behaviour is covered by the
Task 5 e2e and the Task 2 component test.

**Interfaces:**
- Consumes: `HelpModal` from Task 2, `helpOpen` from the store.
- Produces: `<HelpModal />` rendered alongside `<SettingsModal />`; `helpOpen` added to the `inert` expression on the main content wrapper.

- [ ] **Step 1: Add the import**

```tsx
import { HelpModal } from './components/HelpModal'
```

- [ ] **Step 2: Subscribe to `helpOpen`**

Next to `const settingsOpen = useViewerStore((s) => s.settingsOpen)`:

```tsx
  const helpOpen = useViewerStore((s) => s.helpOpen)
```

- [ ] **Step 3: Extend the `inert` expression**

Change:

```tsx
      <div className="flex flex-col flex-1 min-h-0" inert={mobileDrawer !== 'none' || settingsOpen || repairDialogOpen}>
```

to:

```tsx
      <div className="flex flex-col flex-1 min-h-0" inert={mobileDrawer !== 'none' || settingsOpen || repairDialogOpen || helpOpen}>
```

- [ ] **Step 4: Render the modal**

Next to `<SettingsModal />`:

```tsx
      <HelpModal />
```

- [ ] **Step 5: Type-check + full suite**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no errors, all pass.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: render HelpModal and make it inert the background"
```

---

## Task 5: end-to-end spec (hard completion gate)

**Files:**
- Create: `e2e/help-modal.spec.ts`

Follow the structure of the other panel specs (`test.skip(isMobile, ...)` if
the Help menu is desktop-only - check `e2e/model-workflows.spec.ts`'s File
menu usage; the Help menu button is `getByRole('button', { name: 'Help' })`,
its items are `getByRole('menuitem', { name })`).

- [ ] **Step 1: Write the spec**

```ts
import { expect, test } from '@playwright/test'

test.describe('Feature guide', () => {
  test('opens from the Help menu and closes on Escape', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Help menu verified on desktop')
    await page.goto('/')

    await page.getByRole('button', { name: 'Help' }).click()
    await page.getByRole('menuitem', { name: 'Feature guide' }).click()

    const dialog = page.getByRole('dialog', { name: 'Feature guide' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Repair' })).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Overhang heatmap' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/help-modal.spec.ts` (or the repo's
`pnpm test:e2e` invocation). If the Help menu button's accessible name or
the menuitem selectors differ from the guess, adjust to what
`e2e/model-workflows.spec.ts` / the real DOM show. Run twice for stability.
No retries / arbitrary waits.

- [ ] **Step 3: Commit**

```bash
git add e2e/help-modal.spec.ts
git commit -m "test: e2e feature guide opens from the Help menu and closes on Escape"
```

---

## Task 6: docs

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-08-30-print-prep-roadmap.md`

- [ ] **Step 1: README** - add a one-line mention under the feature list
  (or wherever help/UI is described): "Help > Feature guide - an in-app
  summary of every Prepare-panel tool." Match the surrounding style, no em
  dash.

- [ ] **Step 2: CHANGELOG** - add an entry under the current/next version
  heading:

```
- Help menu: a Feature guide modal summarising every Prepare-panel tool
  (readiness checks, Repair, Split, Measure, Scale, Transform, Overhang
  heatmap). Each new feature adds its own entry.
```

- [ ] **Step 3: roadmap** - in
  `docs/superpowers/specs/2026-08-30-print-prep-roadmap.md`:
  (a) add a short note near the SP-4 section (or a small "Cross-cutting"
  subsection): "SP-H (in-app feature help): SHIPPED, branch
  `worktree-sph-in-app-help`, commits `<range>` (fill from git log).
  `HelpModal.tsx` + `helpOpen` store flag + Help-menu entry. Spec:
  `2026-09-06-sph-in-app-help-design.md`; plan:
  `../plans/2026-09-06-sph-in-app-help.md`."
  (b) add a standing-rule line to the "Locked decisions" section near the
  top of the roadmap, so it is remembered regardless of context: **"Every
  sub-project from SP-4b onward ships in the same cycle: code + unit tests
  + a passing e2e; an appended `HELP_SECTIONS` entry in
  `src/components/HelpModal.tsx` (the Help > Feature guide modal); and
  updates to README, CHANGELOG, and this roadmap's SP decomposition table.
  A feature is not done until its in-app help and docs match it."**

- [ ] **Step 4: Sanity check**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: PASS (no code change).

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md docs/superpowers/specs/2026-08-30-print-prep-roadmap.md
git commit -m "docs: record SP-H in-app feature help"
```

---

## Self-Review

**1. Spec coverage:**

| Spec item | Task |
|-----------|------|
| `helpOpen` store flag, not model-reset | 1 |
| `HelpModal` dialog, `HELP_SECTIONS` array, Escape/backdrop/Close close | 2 |
| Help-menu "Feature guide" entry | 3 |
| App renders it + inert | 4 |
| E2e hard gate | 5 |
| Docs + roadmap convention note | 6 |

Non-goals (per-widget tooltips, images, markdown, first-run auto-open, a
`/help` route) have no task, as intended.

**2. Placeholder scan:** No "TBD" / "handle later". Task 2's component code
is complete; Step 3b removes the one ambiguity (two "Close" buttons) by
naming the header icon button `"Close feature guide"`. Task 3 / Task 5
selector-matching notes point at concrete existing files.

**3. Type consistency:** `helpOpen: boolean` / `setHelpOpen(open: boolean)`
used identically in Tasks 1, 2, 3, 4. `HELP_SECTIONS` shape
`{ title: string; body: string }[]` matches the spec and the SP-4b plan's
future "append an entry" task. `HelpModal` takes no props everywhere it is
referenced (Tasks 2, 4).
