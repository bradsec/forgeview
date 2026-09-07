# SP-5c Bed layout - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One "Arrange on plate" button that shelf-packs the scene's models into a non-overlapping grid inside the build-volume footprint and drops each to the plate, as a single undoable step. Translation only.

**Architecture:** New pure `src/services/bedLayout.ts` (`computeBedLayout`). New `Viewer3D` handle `arrangeOnPlate()` that measures each model root's tight world footprint, calls the solver, shifts positions, and pushes one undo entry. A button + note in `TransformSection`. `HelpModal` entry. No store field, no `prepChecks` change.

**Tech Stack:** React 19, three.js 0.185 (`Box3.expandByObject(_, true)`), Zustand 5, Vitest 4, Playwright. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-07-sp5c-bed-layout-design.md`

## Global Constraints

- No new npm dependency.
- No em dash in prose, comments, JSX text, or commit messages. Use commas, colons, or separate sentences.
- No `@testing-library/jest-dom`. Assert with vitest / React Testing Library core.
- TDD: write the failing test first where a task has one, run it red, implement, run green, run the full unit suite, commit.
- Every commit body ends with exactly:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UiM77mQEZ4NcybuEdGMfX5
  ```
- Baseline at plan start: 467 unit tests / 58 files pass, `tsc --noEmit` clean.
- Feature-ship checklist: code + unit tests + a passing e2e + a `HELP_SECTIONS` entry + README / CHANGELOG / roadmap. Tasks 4, 5, 6 cover the last three.

---

### Task 1: `bedLayout.ts` shelf solver

**Files:**
- Create: `src/services/bedLayout.ts`
- Test: `src/services/bedLayout.test.ts`

**Interfaces:**
- Produces: `interface LayoutItem { id: string; w: number; d: number }`, `interface LayoutPlacement { id: string; cx: number; cz: number }`, `interface BedLayoutResult { placements: LayoutPlacement[]; unplaced: string[] }`, `computeBedLayout(items: LayoutItem[], bed: { x: number; z: number }, gap: number): BedLayoutResult`.
- Consumed by: Task 2 (Viewer3D).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { computeBedLayout } from './bedLayout'

describe('computeBedLayout', () => {
  it('places a single item centred on the origin', () => {
    const r = computeBedLayout([{ id: 'a', w: 20, d: 10 }], { x: 200, z: 200 }, 5)
    expect(r.unplaced).toEqual([])
    expect(r.placements).toHaveLength(1)
    expect(r.placements[0]).toMatchObject({ id: 'a' })
    expect(r.placements[0].cx).toBeCloseTo(0)
    expect(r.placements[0].cz).toBeCloseTo(0)
  })

  it('lays three same-size items in one row with the gap between them', () => {
    const items = [
      { id: 'a', w: 20, d: 20 },
      { id: 'b', w: 20, d: 20 },
      { id: 'c', w: 20, d: 20 },
    ]
    const r = computeBedLayout(items, { x: 200, z: 200 }, 10)
    expect(r.unplaced).toEqual([])
    const byId = Object.fromEntries(r.placements.map((p) => [p.id, p]))
    // centres 30 apart (20 width + 10 gap), symmetric about 0
    const xs = ['a', 'b', 'c'].map((k) => byId[k].cx).sort((p, q) => p - q)
    expect(xs[1] - xs[0]).toBeCloseTo(30)
    expect(xs[2] - xs[1]).toBeCloseTo(30)
    expect(xs[0] + xs[2]).toBeCloseTo(0)
    // all in the same row
    for (const k of ['a', 'b', 'c']) expect(byId[k].cz).toBeCloseTo(byId.a.cz)
  })

  it('wraps to a new row when the next item overflows the bed width', () => {
    // all the same size so the depth-then-width sort keeps input order
    const items = [
      { id: 'a', w: 60, d: 30 },
      { id: 'b', w: 60, d: 30 },
      { id: 'c', w: 60, d: 30 }, // 3 * 60 + 2 * gap = 190 < 200 -> still row 1
      { id: 'd', w: 60, d: 30 }, // 4th overflows the width -> row 2
    ]
    const r = computeBedLayout(items, { x: 200, z: 200 }, 5)
    expect(r.unplaced).toEqual([])
    const byId = Object.fromEntries(r.placements.map((p) => [p.id, p]))
    // a, b, c share a row; d is on the next row (row depth 30 + gap 5)
    expect(byId.b.cz).toBeCloseTo(byId.a.cz)
    expect(byId.c.cz).toBeCloseTo(byId.a.cz)
    expect(byId.d.cz - byId.a.cz).toBeCloseTo(35)
    // row 1 centres are 65 apart (60 width + 5 gap) and symmetric about 0
    const xs = [byId.a.cx, byId.b.cx, byId.c.cx].sort((p, q) => p - q)
    expect(xs[1] - xs[0]).toBeCloseTo(65)
    expect(xs[0] + xs[2]).toBeCloseTo(0)
  })

  it('marks an item wider than the bed as unplaced and still lays the rest', () => {
    const r = computeBedLayout(
      [{ id: 'big', w: 300, d: 10 }, { id: 'ok', w: 20, d: 20 }],
      { x: 200, z: 200 },
      5,
    )
    expect(r.unplaced).toEqual(['big'])
    expect(r.placements.map((p) => p.id)).toEqual(['ok'])
  })

  it('marks items that overflow the bed depth as unplaced', () => {
    // rows of depth 80 each; bed.z 200 fits 2 rows (0..80, 85..165), the 3rd (170..250) overflows
    const items = Array.from({ length: 9 }, (_, i) => ({ id: String(i), w: 90, d: 80 }))
    const r = computeBedLayout(items, { x: 200, z: 200 }, 5)
    // 2 per row (2 * 90 + 5 = 185 < 200), 2 rows placed -> 4 items, 5 unplaced
    expect(r.placements).toHaveLength(4)
    expect(r.unplaced).toHaveLength(5)
  })

  it('returns empty for no items', () => {
    expect(computeBedLayout([], { x: 100, z: 100 }, 5)).toEqual({ placements: [], unplaced: [] })
  })
})
```

- [ ] **Step 2:** run red: `pnpm test src/services/bedLayout.test.ts`.

- [ ] **Step 3: Implement** `src/services/bedLayout.ts`:

```ts
export interface LayoutItem {
  id: string
  w: number
  d: number
}

export interface LayoutPlacement {
  id: string
  cx: number
  cz: number
}

export interface BedLayoutResult {
  placements: LayoutPlacement[]
  unplaced: string[]
}

/**
 * Shelf pack: sort by depth then width descending, fill rows left to right
 * within `bed.x`, start a new row (offset on Z by the previous row's tallest
 * footprint plus `gap`) when the next item overflows. An item wider than
 * `bed.x`, or a row that overflows `bed.z`, goes to `unplaced`. The packed
 * block is finally centred on the origin.
 */
export function computeBedLayout(
  items: LayoutItem[],
  bed: { x: number; z: number },
  gap: number,
): BedLayoutResult {
  const sorted = items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => b.it.d - a.it.d || b.it.w - a.it.w || a.i - b.i)
    .map((e) => e.it)

  const raw: { id: string; rx: number; rz: number; w: number; d: number }[] = []
  const unplaced: string[] = []
  let cursorX = 0
  let cursorZ = 0
  let rowMaxD = 0

  for (const it of sorted) {
    if (it.w > bed.x) { unplaced.push(it.id); continue }
    if (cursorX > 0 && cursorX + it.w > bed.x) {
      cursorX = 0
      cursorZ += rowMaxD + gap
      rowMaxD = 0
    }
    if (cursorZ + it.d > bed.z) { unplaced.push(it.id); continue }
    raw.push({ id: it.id, rx: cursorX + it.w / 2, rz: cursorZ + it.d / 2, w: it.w, d: it.d })
    cursorX += it.w + gap
    rowMaxD = Math.max(rowMaxD, it.d)
  }

  if (raw.length === 0) return { placements: [], unplaced }

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const p of raw) {
    minX = Math.min(minX, p.rx - p.w / 2)
    maxX = Math.max(maxX, p.rx + p.w / 2)
    minZ = Math.min(minZ, p.rz - p.d / 2)
    maxZ = Math.max(maxZ, p.rz + p.d / 2)
  }
  const shiftX = -(minX + maxX) / 2
  const shiftZ = -(minZ + maxZ) / 2

  return {
    placements: raw.map((p) => ({ id: p.id, cx: p.rx + shiftX, cz: p.rz + shiftZ })),
    unplaced,
  }
}
```

- [ ] **Step 4:** run green, full suite: `pnpm exec tsc --noEmit && pnpm test`.

- [ ] **Step 5: Commit**

```bash
git add src/services/bedLayout.ts src/services/bedLayout.test.ts
git commit -m "feat: bedLayout - shelf pack model footprints into the build volume"
```

---

### Task 2: Viewer3D `arrangeOnPlate()` handle

**Files:**
- Modify: `src/components/Viewer3D.tsx`

No unit test (jsdom has no WebGL). Verification: `tsc --noEmit` clean + full suite no regression.

**Interfaces:**
- Consumes: `computeBedLayout` from `../services/bedLayout`; existing `modelGroupRef`, `modelMapRef`, `pushUndo`, `updateGeometryDetails`, `refreshSceneEnvironment`, `invalidate`; store `buildVolumeMm` and `geometryDetails.modelUnitInMm`.
- Produces: `export type ArrangeOutcome` and an `arrangeOnPlate: () => ArrangeOutcome` handle method.

- [ ] **Step 1: import + type.** Add the import next to the other `../services/*` imports:

```ts
import { computeBedLayout } from '../services/bedLayout'
```

Add the type just below the `AutoOrientOutcome` type (ends ~line 54, before `export interface Viewer3DHandle` at ~56):

```ts
export type ArrangeOutcome =
  | { status: 'arranged'; placed: number; total: number }
  | { status: 'empty' }
```

Add to `Viewer3DHandle`, right after `autoOrient: () => AutoOrientOutcome` (~line 96):

```ts
  arrangeOnPlate: () => ArrangeOutcome
```

- [ ] **Step 2: implement.** Insert the method between the `autoOrient` handle's closing `},` (~line 989) and `runRepair:` (~line 990):

```ts
    arrangeOnPlate: () => {
      // The scene's independent models: the single-file preview root plus every
      // multi-model entry. NOT the split-parts group (that is one model's
      // pieces; the Transform lock already blocks the button while split).
      const roots = [modelGroupRef.current, ...modelMapRef.current.values()]
        .filter((r): r is THREE.Object3D => Boolean(r))
        .filter((r) => {
          let has = false
          r.traverse((c) => {
            if (c instanceof THREE.Mesh && (c.geometry as THREE.BufferGeometry).getAttribute('position')?.count) has = true
          })
          return has
        })
      if (roots.length === 0) return { status: 'empty' as const }

      const unit = useViewerStore.getState().geometryDetails?.modelUnitInMm ?? 1
      const bvol = useViewerStore.getState().buildVolumeMm
      const bed = { x: bvol.x / unit, z: bvol.z / unit }
      const gap = Math.max(3 / unit, bed.x * 1e-3)

      const info = roots.map((r) => {
        const box = new THREE.Box3().expandByObject(r, true)
        const size = box.getSize(new THREE.Vector3())
        const centre = box.getCenter(new THREE.Vector3())
        return { r, w: size.x, d: size.z, cx: centre.x, cz: centre.z, minY: box.min.y }
      })

      const { placements } = computeBedLayout(
        info.map((i) => ({ id: i.r.uuid, w: i.w, d: i.d })),
        bed,
        gap,
      )
      const byId = new Map(info.map((i) => [i.r.uuid, i]))
      const prevPos = roots.map((r) => r.position.clone())

      for (const p of placements) {
        const i = byId.get(p.id)
        if (!i) continue
        i.r.position.x += p.cx - i.cx
        i.r.position.z += p.cz - i.cz
        i.r.position.y += -i.minY
      }

      pushUndo({
        label: 'Arrange on plate',
        apply: () => {
          const live = [modelGroupRef.current, ...modelMapRef.current.values()]
            .filter((r): r is THREE.Object3D => Boolean(r))
          live.forEach((r, idx) => { if (prevPos[idx]) r.position.copy(prevPos[idx]) })
          updateGeometryDetails()
          refreshSceneEnvironment()
          invalidate()
        },
        discard: () => {},
      })
      updateGeometryDetails()
      refreshSceneEnvironment()
      invalidate()

      return { status: 'arranged' as const, placed: placements.length, total: roots.length }
    },
```

- [ ] **Step 3: ripple.** Adding a required member to `Viewer3DHandle` breaks the full mock literal in `src/components/SceneControls.test.tsx` (`satisfies Viewer3DHandle`). Add `arrangeOnPlate: vi.fn(),` next to `autoOrient: vi.fn(),` there. `tsc --noEmit` will flag any other full-handle mock; there is only the one as of this plan.

- [ ] **Step 4:** `pnpm exec tsc --noEmit && pnpm test` - clean, no previously-passing test now failing.

- [ ] **Step 5: Commit**

```bash
git add src/components/Viewer3D.tsx src/components/SceneControls.test.tsx
git commit -m "feat: Viewer3D - arrangeOnPlate handle shelf-packs the scene onto the plate"
```

---

### Task 3: TransformSection "Arrange on plate" button

**Files:**
- Modify: `src/components/prepare/TransformSection.tsx`
- Test: `src/components/prepare/TransformSection.test.tsx` (extend)

**Interfaces:**
- Consumes: `viewerRef.current.arrangeOnPlate()` and its `ArrangeOutcome`.
- Produces: an "Arrange on plate" button after "Auto-orient" in the Drop / Center row, plus a `layoutNote` `<p>`.

- [ ] **Step 1: Write the failing test** (append to `TransformSection.test.tsx`; note the file-level `beforeEach` sets `geometryDetails` / `splitParts: []` / `measureMode: false`)

```ts
describe('TransformSection - arrange on plate', () => {
  it('calls arrangeOnPlate and shows the all-placed note', async () => {
    const arrangeOnPlate = vi.fn(() => ({ status: 'arranged', placed: 3, total: 3 }))
    render(<TransformSection viewerRef={{ current: { arrangeOnPlate } as never }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Arrange on plate' }))
    expect(arrangeOnPlate).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Arranged 3 models')).toBeTruthy()
  })

  it('reports when some models do not fit', async () => {
    const arrangeOnPlate = vi.fn(() => ({ status: 'arranged', placed: 2, total: 5 }))
    render(<TransformSection viewerRef={{ current: { arrangeOnPlate } as never }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Arrange on plate' }))
    expect(screen.getByText('Arranged 2 of 5, the rest do not fit')).toBeTruthy()
  })

  it('says nothing for an empty scene', async () => {
    const arrangeOnPlate = vi.fn(() => ({ status: 'empty' }))
    render(<TransformSection viewerRef={{ current: { arrangeOnPlate } as never }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Arrange on plate' }))
    expect(screen.queryByText(/Arranged/)).toBeNull()
  })

  it('disables the button while locked', () => {
    useViewerStore.setState({ splitParts: [{ id: 'a', name: 'a', triangleCount: 1, visible: true }] })
    render(<TransformSection viewerRef={{ current: null }} />)
    expect((screen.getByRole('button', { name: 'Arrange on plate' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
```

- [ ] **Step 2:** run red.

- [ ] **Step 3: Implement.** In `TransformSection.tsx`:

- Add state next to `orientNote`: `const [layoutNote, setLayoutNote] = useState<string | null>(null)`.
- Add the handler next to `runAutoOrient`:

```ts
  const runArrange = () => {
    const r = viewerRef.current?.arrangeOnPlate()
    if (!r || r.status === 'empty') return
    if (r.placed === r.total) setLayoutNote(`Arranged ${r.total} model${r.total === 1 ? '' : 's'}`)
    else setLayoutNote(`Arranged ${r.placed} of ${r.total}, the rest do not fit`)
  }
```

- In the final `<div className="flex gap-2">` (Drop to floor / Center on plate / Auto-orient), add a fourth button after "Auto-orient":

```tsx
          <button
            type="button"
            disabled={locked}
            onClick={runArrange}
            className="px-3 py-1.5 rounded bg-[var(--bg-button)] text-sm disabled:opacity-50"
          >
            Arrange on plate
          </button>
```

- After the `{orientNote && ...}` `<p>`, add:

```tsx
        {layoutNote && <p className="text-xs text-[var(--text-muted)]">{layoutNote}</p>}
```

- Clear `layoutNote` (set to `null`) in `applyMove` and in the "Drop to floor" and "Center on plate" `onClick`s (a manual reposition invalidates the arrangement), mirroring how `orientNote` is cleared on rotate / mirror. Do NOT clear it in `applyRotate` / `applyScale` (those keep positions).

- [ ] **Step 4:** run green, full suite.

- [ ] **Step 5: Commit**

```bash
git add src/components/prepare/TransformSection.tsx src/components/prepare/TransformSection.test.tsx
git commit -m "feat: TransformSection - Arrange on plate button and result note"
```

---

### Task 4: HELP_SECTIONS entry

**Files:**
- Modify: `src/components/HelpModal.tsx`
- Test: `src/components/HelpModal.test.tsx` (extend)

- [ ] **Step 1: Write the failing test** - add to the "renders the guide" test: `expect(screen.getByRole('heading', { name: 'Arrange on plate' })).toBeTruthy()`.

- [ ] **Step 2:** run red.

- [ ] **Step 3: Implement** - append to `HELP_SECTIONS`, after "Auto-orient":

```ts
  {
    title: 'Arrange on plate',
    body: 'Arrange on plate lays every model in the scene out in a grid inside the build volume footprint and drops each to the plate, as one undoable step. It only moves models, it does not rotate or scale them. Models too large for the footprint are left where they are and reported.',
  },
```

- [ ] **Step 4:** run green, full suite.

- [ ] **Step 5: Commit**

```bash
git add src/components/HelpModal.tsx src/components/HelpModal.test.tsx
git commit -m "docs: HelpModal - Arrange on plate feature-guide entry"
```

---

### Task 5: e2e spec (hard completion gate)

**Files:**
- Create: `e2e/bed-layout.spec.ts`

Mirror `e2e/auto-orient.spec.ts` (read it): inline STL + `DragEvent('drop')`, `.filter({ visible: true })` on every locator, `test.skip(isMobile, ...)`, `test.setTimeout(120_000)`. Also read it for the `undo-history` locator.

The browser drop path loads a single model; multi-model needs the directory browser, so the e2e exercises the wiring with one model.

- [ ] **Step 1: Write the spec**

```ts
import { expect, test, type Page } from '@playwright/test'

/** ASCII STL of an axis-aligned box (corner at the origin), outward winding. */
function boxStl(w: number, h: number, d: number): string {
  const v = [
    [0, 0, 0], [w, 0, 0], [w, h, 0], [0, h, 0],
    [0, 0, d], [w, 0, d], [w, h, d], [0, h, d],
  ]
  const tris = [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
    [0, 5, 1], [0, 4, 5], [1, 6, 2], [1, 5, 6],
    [2, 7, 3], [2, 6, 7], [3, 4, 0], [3, 7, 4],
  ]
  let out = 'solid box\n'
  for (const [a, b, c] of tris) {
    out += 'facet normal 0 0 0\nouter loop\n'
    for (const i of [a, b, c]) out += `vertex ${v[i][0]} ${v[i][1]} ${v[i][2]}\n`
    out += 'endloop\nendfacet\n'
  }
  return out + 'endsolid box\n'
}

async function dropStl(page: Page, stl: string, name: string): Promise<void> {
  await page.goto('/')
  await page.evaluate(
    ({ stl, name }) => {
      const file = new File([stl], name, { type: 'model/stl' })
      const dt = new DataTransfer()
      dt.items.add(file)
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    },
    { stl, name }
  )
  await expect(page.getByRole('banner')).toContainText(name)
  await expect(page.getByRole('navigation', { name: 'Camera navigation' })).toBeVisible()
}

test.describe('Bed layout', () => {
  test('arranges the scene, reports the count, and undoes', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Bed layout flow verified on desktop')
    test.setTimeout(120_000)

    await dropStl(page, boxStl(30, 20, 25), 'box.stl')
    await page.getByRole('button', { name: 'Prepare' }).filter({ visible: true }).click()

    await page.getByRole('button', { name: 'Arrange on plate' }).filter({ visible: true }).click()

    await expect(page.getByText('Arranged 1 model').filter({ visible: true })).toBeVisible()

    const undoHistory = page.getByTestId('undo-history').filter({ visible: true })
    await expect(undoHistory.getByRole('button', { name: /Arrange on plate/i })).toBeVisible()

    await undoHistory.getByRole('button', { name: /Arrange on plate/i }).click()
    await expect(page.getByTestId('undo-history').filter({ visible: true })).toHaveCount(0)
  })
})
```

- [ ] **Step 2: Run it.** `npx playwright test e2e/bed-layout.spec.ts`. Adjust selectors to the real DOM if the note wording, the undo control, or the "Arranged 1 model" string differ from this draft (source of truth: `e2e/auto-orient.spec.ts` + `TransformSection.tsx`). Run twice for stability. No retries, no arbitrary waits. If Arrange on plate throws, STOP and report BLOCKED.

- [ ] **Step 3: Commit**

```bash
git add e2e/bed-layout.spec.ts
git commit -m "test: e2e arrange on plate places the scene and undoes"
```

---

### Task 6: docs

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-08-30-print-prep-roadmap.md`

- [ ] **Step 1: README** - add a short "Arrange on plate" mention by the Transform / Auto-orient bullets. No em dash.

- [ ] **Step 2: CHANGELOG** - under the current unreleased heading, matching the SP-5b entry format:

```
- Prepare panel: bed layout (SP-5c). Arrange on plate shelf-packs every
  model in the scene into a grid inside the build-volume footprint and
  drops each to the plate as one undoable step. Models too large for the
  footprint are left alone and reported.
```

- [ ] **Step 3: roadmap** - in the "SP-5 decomposition" table, change the SP-5c row to SHIPPED: branch `worktree-sp5c-bed-layout`, commit range (from `git log`), files (`src/services/bedLayout.ts`, `src/components/Viewer3D.tsx` `arrangeOnPlate` handle, `src/components/prepare/TransformSection.tsx` button + note, `src/components/HelpModal.tsx` entry, `e2e/bed-layout.spec.ts`), spec/plan links. Add a line that SP-5 (auto-orient + build volume) is now complete.

- [ ] **Step 4: Sanity** - `pnpm exec tsc --noEmit && pnpm test`.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md docs/superpowers/specs/2026-08-30-print-prep-roadmap.md
git commit -m "docs: record SP-5c bed layout"
```

---

## Self-Review

**1. Spec coverage:**

| Spec item | Task |
|-----------|------|
| `bedLayout.ts` shelf pack: sort d-then-w desc, row wrap on bed.x, unplaced on too-wide / bed.z overflow, centre on origin | 1 |
| Viewer3D `arrangeOnPlate()` handle: preview + multi-model roots (not split parts), tight footprint, `buildVolumeMm / unit` bed, ~3mm gap, one undo entry, `ArrangeOutcome` | 2 |
| `SceneControls.test.tsx` mock ripple | 2 |
| TransformSection button + `layoutNote` (all-placed / partial / empty) | 3 |
| `HELP_SECTIONS` entry | 4 |
| e2e hard gate: arrange + note + undo round-trip | 5 |
| README / CHANGELOG / roadmap, SP-5 marked complete | 6 |

Non-goals (bin-packing, rotate-to-fit, per-part layout, stacking, stable/incremental layout, store field) have no task, as intended.

**2. Placeholder scan:** No "TBD". Task 1 gives the full solver + full test; Task 2 gives the full handle; Task 3 gives the full JSX and handler; Task 5 gives the full fixture + spec.

**3. Type consistency:** `LayoutItem { id, w, d }` / `LayoutPlacement { id, cx, cz }` / `BedLayoutResult { placements, unplaced }` are consistent between Task 1 (definition) and Task 2 (call). `computeBedLayout(items, bed, gap)` signature matches. `ArrangeOutcome` (Task 2) has `status: 'arranged' | 'empty'`; Task 3 reads `r.status`, `r.placed`, `r.total`. The handle returns `placed: placements.length` and `total: roots.length`.
