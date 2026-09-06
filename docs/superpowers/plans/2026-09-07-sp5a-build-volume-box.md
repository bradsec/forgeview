# SP-5a Build-volume box - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw the configured printer build volume as a wireframe box plus a footprint grid on the world plate, toggled from the Prepare panel. It is a fixed reference: it never moves or scales the model.

**Architecture:** New `showBuildVolume` store flag. New pure-three `src/services/buildVolumeOverlay.ts` builds a `THREE.Group` (an `EdgesGeometry` box + a `GridHelper` footprint, tagged `userData.buildVolumeOverlay`). `Viewer3D` mounts/unmounts it from one lifecycle effect keyed on the flag and the three `buildVolumeMm` dimensions. No interlock, no model mutation. `exporters.ts` skip-guard gains the tag. `ScaleSection` gets the toggle, `HelpModal` an entry.

**Tech Stack:** React 19, three.js 0.185 (`BoxGeometry`, `EdgesGeometry`, `GridHelper`, `LineSegments` all built in), Zustand 5, Vitest 4, Playwright. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-07-sp5a-build-volume-box-design.md`

## Global Constraints

- No new npm dependency.
- No em dash in prose, comments, JSX text, or commit messages. Use commas, colons, or separate sentences.
- No `@testing-library/jest-dom`. Assert with vitest / React Testing Library core, matching existing test files.
- TDD: write the failing test first where a task has one, run it red, implement, run green, run the full unit suite, commit.
- Every commit body ends with exactly:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UiM77mQEZ4NcybuEdGMfX5
  ```
- Baseline at plan start: 445 unit tests / 56 files pass, `tsc --noEmit` clean.
- Feature-ship checklist: this cycle ships code + unit tests + a passing e2e + a `HELP_SECTIONS` entry + README / CHANGELOG / roadmap. Tasks 6, 7, 8 cover the last three.

---

### Task 1: store `showBuildVolume`

**Files:**
- Modify: `src/store/viewerStore.ts`
- Test: `src/store/viewerStore.test.ts` (extend)

**Interfaces:**
- Produces: `showBuildVolume: boolean` (default `false`), `setShowBuildVolume(on: boolean): void`. NOT reset by `setFile` / `setFileFromBuffer`.

- [ ] **Step 1: Write the failing test** (append to `viewerStore.test.ts`)

```ts
describe('build volume box state', () => {
  beforeEach(() => useViewerStore.setState({ showBuildVolume: false }))

  it('defaults to false', () => {
    expect(useViewerStore.getState().showBuildVolume).toBe(false)
  })

  it('setShowBuildVolume flips it', () => {
    useViewerStore.getState().setShowBuildVolume(true)
    expect(useViewerStore.getState().showBuildVolume).toBe(true)
  })

  it('setFile does not reset it (sticky view preference)', () => {
    useViewerStore.getState().setShowBuildVolume(true)
    useViewerStore.getState().setFile('/m.stl', 'm.stl', '.stl', 1)
    expect(useViewerStore.getState().showBuildVolume).toBe(true)
  })
})
```

- [ ] **Step 2:** run red: `pnpm test src/store/viewerStore.test.ts`.

- [ ] **Step 3: Implement.** In `src/store/viewerStore.ts`, next to the SP-4c `xrayMode` / `clipMode` fields in the state type:

```ts
  showBuildVolume: boolean
  setShowBuildVolume: (on: boolean) => void
```

In the initializer, next to `xrayMode: false,` etc.:

```ts
  showBuildVolume: false,
  setShowBuildVolume: (on) => set({ showBuildVolume: on }),
```

Do NOT touch `setFile` / `setFileFromBuffer`.

- [ ] **Step 4:** `pnpm exec tsc --noEmit && pnpm test` clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/viewerStore.ts src/store/viewerStore.test.ts
git commit -m "feat: showBuildVolume store flag"
```

---

### Task 2: `buildVolumeOverlay.ts`

**Files:**
- Create: `src/services/buildVolumeOverlay.ts`
- Test: `src/services/buildVolumeOverlay.test.ts`

**Interfaces:**
- Produces: `interface BuildVolumeColors { edge: number; grid: number }`, `buildBuildVolumeOverlay(volumeMm: { x: number; y: number; z: number }, colors: BuildVolumeColors): THREE.Group`, `disposeBuildVolumeOverlay(group: THREE.Group): void`.
- Consumed by: Task 3 (Viewer3D), Task 4 references the `userData.buildVolumeOverlay` tag.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildBuildVolumeOverlay, disposeBuildVolumeOverlay } from './buildVolumeOverlay'

describe('buildVolumeOverlay', () => {
  const colors = { edge: 0xe68a4e, grid: 0x3f4146 }

  it('returns a tagged group with a box and a footprint grid', () => {
    const g = buildBuildVolumeOverlay({ x: 220, y: 250, z: 220 }, colors)
    expect(g.userData.buildVolumeOverlay).toBe(true)
    const lineSegments = g.children.filter((c) => c instanceof THREE.LineSegments)
    expect(lineSegments.length).toBe(2) // EdgesGeometry box + GridHelper
  })

  it('sits the box base on y=0 (centre lifted half the height)', () => {
    const g = buildBuildVolumeOverlay({ x: 100, y: 80, z: 100 }, colors)
    const box = g.children.find(
      (c) => c instanceof THREE.LineSegments && !(c as THREE.GridHelper).isGridHelper,
    ) as THREE.LineSegments
    expect(box.position.y).toBeCloseTo(40)
  })

  it('box edge geometry spans the requested dimensions', () => {
    const g = buildBuildVolumeOverlay({ x: 120, y: 60, z: 90 }, colors)
    const box = g.children.find(
      (c) => c instanceof THREE.LineSegments && !(c as THREE.GridHelper).isGridHelper,
    ) as THREE.LineSegments
    box.geometry.computeBoundingBox()
    const size = box.geometry.boundingBox!.getSize(new THREE.Vector3())
    expect(size.x).toBeCloseTo(120)
    expect(size.y).toBeCloseTo(60)
    expect(size.z).toBeCloseTo(90)
  })

  it('clamps a non-positive dimension to 1 instead of throwing', () => {
    expect(() => buildBuildVolumeOverlay({ x: 0, y: -5, z: 100 }, colors)).not.toThrow()
    const g = buildBuildVolumeOverlay({ x: 0, y: -5, z: 100 }, colors)
    const box = g.children.find(
      (c) => c instanceof THREE.LineSegments && !(c as THREE.GridHelper).isGridHelper,
    ) as THREE.LineSegments
    box.geometry.computeBoundingBox()
    const size = box.geometry.boundingBox!.getSize(new THREE.Vector3())
    expect(size.x).toBeCloseTo(1)
    expect(size.y).toBeCloseTo(1)
  })

  it('dispose frees child geometry and materials and detaches the group', () => {
    const g = buildBuildVolumeOverlay({ x: 100, y: 100, z: 100 }, colors)
    const scene = new THREE.Scene()
    scene.add(g)
    disposeBuildVolumeOverlay(g)
    expect(g.parent).toBeNull()
  })
})
```

- [ ] **Step 2:** run red: `pnpm test src/services/buildVolumeOverlay.test.ts`.

- [ ] **Step 3: Implement** `src/services/buildVolumeOverlay.ts` exactly:

```ts
import * as THREE from 'three'

export interface BuildVolumeColors {
  edge: number
  grid: number
}

/**
 * A wireframe box for a printer build volume: footprint `x` by `z`
 * millimetres, height `y`, base on the plane y=0, centred on x=z=0. Plus a
 * footprint grid on y=0. Line geometry only. The returned group is tagged
 * `userData.buildVolumeOverlay = true` so exporters skip it.
 */
export function buildBuildVolumeOverlay(
  volumeMm: { x: number; y: number; z: number },
  colors: BuildVolumeColors,
): THREE.Group {
  const group = new THREE.Group()
  group.userData.buildVolumeOverlay = true

  const safeX = volumeMm.x > 0 ? volumeMm.x : 1
  const safeY = volumeMm.y > 0 ? volumeMm.y : 1
  const safeZ = volumeMm.z > 0 ? volumeMm.z : 1

  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(safeX, safeY, safeZ)),
    new THREE.LineBasicMaterial({ color: colors.edge }),
  )
  box.position.set(0, safeY / 2, 0)
  group.add(box)

  const footprint = Math.max(safeX, safeZ)
  const divisions = Math.min(60, Math.max(4, Math.round(footprint / 10)))
  const grid = new THREE.GridHelper(footprint, divisions, colors.grid, colors.grid)
  grid.scale.set(safeX / footprint, 1, safeZ / footprint)
  grid.position.set(0, 0, 0)
  group.add(grid)

  return group
}

export function disposeBuildVolumeOverlay(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.LineSegments) {
      child.geometry.dispose()
      ;(child.material as THREE.Material).dispose()
    }
  })
  group.parent?.remove(group)
}
```

- [ ] **Step 4:** run green, full suite: `pnpm exec tsc --noEmit && pnpm test`.

- [ ] **Step 5: Commit**

```bash
git add src/services/buildVolumeOverlay.ts src/services/buildVolumeOverlay.test.ts
git commit -m "feat: buildVolumeOverlay - wireframe printer volume group"
```

---

### Task 3: Viewer3D wiring

**Files:**
- Modify: `src/components/Viewer3D.tsx`

No unit test (jsdom has no WebGL). Verification: `tsc --noEmit` clean + full suite no regression (baseline 445 tests / 56 files).

**Interfaces:**
- Consumes: `buildBuildVolumeOverlay` / `disposeBuildVolumeOverlay` from `../services/buildVolumeOverlay`; `getTheme` (already imported from `../themes`); store `showBuildVolume`, `buildVolumeMm`; existing `sceneRef`, `invalidate`, `rendererGen`.
- Produces: a `buildVolumeOverlayRef` + `rebuildBuildVolumeOverlay` / `teardownBuildVolumeOverlay` helpers; one lifecycle effect.

- [ ] **Step 1: import.** Add near the other service imports:

```ts
import { buildBuildVolumeOverlay, disposeBuildVolumeOverlay } from '../services/buildVolumeOverlay'
```

Confirm `getTheme` is already imported from `../themes` (it is used by `rebuildGrid`). If not, add it.

- [ ] **Step 2: ref + helpers.** Immediately AFTER the `const teardownClip = () => { ... }` function (currently ends ~line 583, just before `const applyLoopFill`):

```ts
  const buildVolumeOverlayRef = useRef<THREE.Group | null>(null)

  const rebuildBuildVolumeOverlay = () => {
    const scene = sceneRef.current
    if (!scene) return
    teardownBuildVolumeOverlay()
    const theme = getTheme(useViewerStore.getState().theme)
    const group = buildBuildVolumeOverlay(useViewerStore.getState().buildVolumeMm, {
      edge: new THREE.Color(theme.accent).getHex(),
      grid: theme.gridPrimary,
    })
    scene.add(group)
    buildVolumeOverlayRef.current = group
    invalidate()
  }

  const teardownBuildVolumeOverlay = () => {
    if (buildVolumeOverlayRef.current) disposeBuildVolumeOverlay(buildVolumeOverlayRef.current)
    buildVolumeOverlayRef.current = null
    invalidate()
  }
```

- [ ] **Step 3: effect.** After the SP-4c Effect 20 block (ends `}, [repairDialogOpen, xrayMode, clipMode])`, currently ~line 2225) and BEFORE the `// Effect 11: Split-by-shell part visibility` comment:

```ts
  // Effect 23: Build-volume box - draw the configured printer volume as a
  // wireframe box on the plate while shown. Static reference geometry, no
  // interlock: it never hides or edits the model.
  const showBuildVolume = useViewerStore((s) => s.showBuildVolume)
  const buildVolumeMm = useViewerStore((s) => s.buildVolumeMm)
  useEffect(() => {
    if (!showBuildVolume) return
    rebuildBuildVolumeOverlay()
    return () => {
      teardownBuildVolumeOverlay()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBuildVolume, buildVolumeMm.x, buildVolumeMm.y, buildVolumeMm.z, rendererGen])
```

If a `buildVolumeMm` selector already exists elsewhere in the component, do NOT redeclare it: reuse the existing `const` and keep only the `showBuildVolume` selector here (grep first). As of this plan there is no `buildVolumeMm` selector in `Viewer3D.tsx`, only `useViewerStore.getState().buildVolumeMm` reads.

- [ ] **Step 4:** `pnpm exec tsc --noEmit && pnpm test` - clean, 445 tests, no regression.

- [ ] **Step 5: Commit**

```bash
git add src/components/Viewer3D.tsx
git commit -m "feat: Viewer3D - mount the build-volume box while shown"
```

---

### Task 4: exporters skip guard

**Files:**
- Modify: `src/services/exporters.ts`
- Test: `src/services/exporters.test.ts` (extend)

- [ ] **Step 1: Write the failing test** - mirror the existing `userData.wallThicknessOverlay` exclusion test in `exporters.test.ts`, for `userData.buildVolumeOverlay` (a group tagged with it, containing one mesh, asserts `collectExportMeshes(scene)` returns length 0).

- [ ] **Step 2:** run red.

- [ ] **Step 3: Implement** - in `collectExportMeshes`'s `visit`, extend the guard:

```ts
if (node.userData.measureOverlay || node.userData.holeOverlay || node.userData.overhangOverlay || node.userData.wallThicknessOverlay || node.userData.buildVolumeOverlay) return
```

Update the comment above it to mention the build-volume box. No em dash.

- [ ] **Step 4:** run green, full suite.

- [ ] **Step 5: Commit**

```bash
git add src/services/exporters.ts src/services/exporters.test.ts
git commit -m "feat: exclude the build-volume box from exported files"
```

---

### Task 5: ScaleSection toggle

**Files:**
- Modify: `src/components/prepare/ScaleSection.tsx`
- Test: `src/components/prepare/ScaleSection.test.tsx` (extend)

**Interfaces:**
- Consumes: store `showBuildVolume`, `setShowBuildVolume`.
- Produces: a "Show build volume" / "Hide build volume" toggle button directly under the "Scale to build volume (mm)" input row.

- [ ] **Step 1: Write the failing test** (append to `ScaleSection.test.tsx`; match the file's existing render/store setup - read it first)

```ts
describe('ScaleSection - build volume box toggle', () => {
  beforeEach(() => useViewerStore.setState({ showBuildVolume: false }))

  it('toggles showBuildVolume from the button', async () => {
    render(<ScaleSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Show build volume' }))
    expect(useViewerStore.getState().showBuildVolume).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Hide build volume' }))
    expect(useViewerStore.getState().showBuildVolume).toBe(false)
  })

  it('reflects the current store state as aria-pressed', () => {
    useViewerStore.setState({ showBuildVolume: true })
    render(<ScaleSection />)
    const btn = screen.getByRole('button', { name: 'Hide build volume' })
    expect(btn.getAttribute('aria-pressed')).toBe('true')
  })
})
```

If `ScaleSection.test.tsx` does not exist, create it with the same imports and store-reset pattern used by `AnalysisSection.test.tsx`, plus whatever `geometryDetails` fixture ScaleSection needs to render (read `ScaleSection.tsx` - it reads `geometryDetails` for the dimensions; a `null` `geometryDetails` render must still show the toggle, since the box is useful without a model).

- [ ] **Step 2:** run red.

- [ ] **Step 3: Implement.** In `ScaleSection.tsx`, add the selector near the other `useViewerStore` selectors:

```ts
  const showBuildVolume = useViewerStore((s) => s.showBuildVolume)
```

Directly after the `<div>` that holds the three `Build volume x/y/z` inputs and the Reset button (the block under the `Scale to build volume (mm)` label), before that block's closing `</div>`... place the button as a sibling right after the inputs row:

```tsx
          <button
            type="button"
            aria-pressed={showBuildVolume}
            onClick={() => useViewerStore.getState().setShowBuildVolume(!showBuildVolume)}
            className={
              'mt-1 px-3 py-1.5 rounded text-sm self-start disabled:opacity-50 ' +
              (showBuildVolume ? 'bg-[var(--accent-button)] text-white' : 'bg-[var(--bg-button)]')
            }
          >
            {showBuildVolume ? 'Hide build volume' : 'Show build volume'}
          </button>
```

Do NOT gate it on `!hasModel` or the section's `locked`: showing a reference box mutates nothing and is useful as an empty-bed reference.

- [ ] **Step 4:** run green, full suite.

- [ ] **Step 5: Commit**

```bash
git add src/components/prepare/ScaleSection.tsx src/components/prepare/ScaleSection.test.tsx
git commit -m "feat: ScaleSection - Show build volume toggle"
```

---

### Task 6: HELP_SECTIONS entry

**Files:**
- Modify: `src/components/HelpModal.tsx`
- Test: `src/components/HelpModal.test.tsx` (extend)

- [ ] **Step 1: Write the failing test** - add to the "renders the guide" test: `expect(screen.getByRole('heading', { name: 'Build volume' })).toBeTruthy()`.

- [ ] **Step 2:** run red.

- [ ] **Step 3: Implement** - append to `HELP_SECTIONS`, after "X-ray and clip plane":

```ts
  {
    title: 'Build volume',
    body: 'Show build volume draws your configured printer volume as a wireframe box on the plate, centred on the origin with its base at Z zero. It is a fixed reference and does not move or scale the model. Set the size with the Scale to build volume fields, then use Center on plate and Drop to floor to bring the model onto it. The On plate readiness row reports whether it fits.',
  },
```

- [ ] **Step 4:** run green, full suite.

- [ ] **Step 5: Commit**

```bash
git add src/components/HelpModal.tsx src/components/HelpModal.test.tsx
git commit -m "docs: HelpModal - Build volume feature-guide entry"
```

---

### Task 7: e2e spec (hard completion gate)

**Files:**
- Create: `e2e/build-volume-box.spec.ts`

Mirror `e2e/xray-clipping.spec.ts` (read it): inline cube STL + `DragEvent('drop')`, `.filter({ visible: true })` on every locator, `test.skip(isMobile, ...)`, `test.setTimeout(120_000)`, the `showSaveFilePicker` init-script, the File-menu export flow.

- [ ] **Step 1: Write the spec**

```ts
import { expect, test, type Page } from '@playwright/test'

function cubeStl(): string {
  const v = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ]
  const faces = [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2],
    [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0],
  ]
  let out = 'solid cube\n'
  for (const f of faces) {
    out += 'facet normal 0 0 0\nouter loop\n'
    for (const i of f) out += `vertex ${v[i][0]} ${v[i][1]} ${v[i][2]}\n`
    out += 'endloop\nendfacet\n'
  }
  return out + 'endsolid cube\n'
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

test.describe('Build volume box', () => {
  test('toggles the box, rebuilds on a dimension change, and stays out of exports', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Build volume flow verified on desktop')
    test.setTimeout(120_000)
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
    })

    await dropStl(page, cubeStl(), 'cube.stl')
    await page.getByRole('button', { name: 'Prepare' }).filter({ visible: true }).click()

    const show = page.getByRole('button', { name: 'Show build volume' }).filter({ visible: true })
    await show.click()
    await expect(page.getByRole('button', { name: 'Hide build volume' }).filter({ visible: true })).toBeVisible()

    // A dimension change rebuilds the box; the toggle stays armed.
    const volX = page.getByLabel('Build volume x').filter({ visible: true })
    await volX.fill('120')
    await expect(page.getByRole('button', { name: 'Hide build volume' }).filter({ visible: true })).toBeVisible()

    await page.getByRole('button', { name: 'Hide build volume' }).filter({ visible: true }).click()
    await expect(page.getByRole('button', { name: 'Show build volume' }).filter({ visible: true })).toBeVisible()

    // Re-show, then export: the box is line geometry and tagged, so the STL
    // still holds exactly the cube's 12 triangles.
    await page.getByRole('button', { name: 'Show build volume' }).filter({ visible: true }).click()
    await page.getByRole('button', { name: 'File', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Export model as…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Export model' })
    await expect(dialog).toBeVisible()
    const downloadPromise = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Export', exact: true }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('cube.stl')
  })
})
```

- [ ] **Step 2: Run it.** `npx playwright test e2e/build-volume-box.spec.ts`. Adjust selectors to the real DOM if the toggle name, the "Build volume x" label, or the Scale-section location differ from this draft (the source of truth is `e2e/xray-clipping.spec.ts` + `ScaleSection.tsx`). If the Scale section is a collapsed accordion, expand it first the way other Prepare-panel e2e specs do. Run twice for stability. No retries, no arbitrary waits. If a genuine product bug surfaces (the box throws on a dimension change, the export includes it), STOP and report BLOCKED.

- [ ] **Step 3: Commit**

```bash
git add e2e/build-volume-box.spec.ts
git commit -m "test: e2e build-volume box toggle, dimension rebuild, export exclusion"
```

---

### Task 8: docs

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-08-30-print-prep-roadmap.md`

- [ ] **Step 1: README** - add a short "Build volume" mention near the Scale / Analysis feature bullets, matching the file's style. No em dash.

- [ ] **Step 2: CHANGELOG** - under the current unreleased / next-version heading, matching the SP-4b / SP-4c entry format:

```
- Prepare panel: build-volume box (SP-5a). Show build volume draws the
  configured printer volume as a wireframe box on the plate. It is a fixed
  reference and does not move or scale the model; the On plate readiness
  row reports fit.
```

- [ ] **Step 3: roadmap** - in `docs/superpowers/specs/2026-08-30-print-prep-roadmap.md`, add an "SP-5 decomposition" section after the "SP-4 decomposition" section (mirror that section's format), with a table:
  - SP-5a | Build-volume box | SHIPPED, branch `worktree-sp5a-build-volume-box`, commit range (from `git log`), files (`viewerStore.ts` `showBuildVolume`, `buildVolumeOverlay.ts`, `Viewer3D.tsx` Effect 23, `exporters.ts` skip tag, `ScaleSection.tsx` toggle, `HelpModal.tsx` entry, `e2e/build-volume-box.spec.ts`), spec/plan links.
  - SP-5b | Auto-orient | Not started. Search orientations to reduce overhang / support / height, apply as an undoable transform.
  - SP-5c | Bed layout | Not started. Grid-arrange the multi-model scene within the build-volume footprint. Depends on SP-5a.

- [ ] **Step 4: Sanity** - `pnpm exec tsc --noEmit && pnpm test`.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md docs/superpowers/specs/2026-08-30-print-prep-roadmap.md
git commit -m "docs: record SP-5a build-volume box"
```

---

## Self-Review

**1. Spec coverage:**

| Spec item | Task |
|-----------|------|
| Store `showBuildVolume` + setter, not reset by `setFile` | 1 |
| `buildVolumeOverlay.ts` (tagged group, box base at y=0, dimension clamp, dispose) | 2 |
| Viewer3D ref + helpers + Effect 23 keyed on flag + 3 dims + rendererGen | 3 |
| exporters skip-guard tag + mirror test | 4 |
| ScaleSection toggle, not gated on model/locked | 5 |
| `HELP_SECTIONS` entry | 6 |
| e2e hard gate incl. export exclusion | 7 |
| README / CHANGELOG / roadmap, SP-5 section created, SP-5b/5c noted | 8 |

Non-goals (auto-orient, bed layout, model auto-centre, editable origin, printer presets, filled bed, persisted toggle) have no task, as intended.

**2. Placeholder scan:** No "TBD". Tasks 1, 2, 5, 6, 7 give full test code; Task 2 and Task 3 give the full implementation; Task 4 mirrors a named existing test.

**3. Type consistency:** `showBuildVolume: boolean` used identically in Tasks 1, 3, 5. `buildBuildVolumeOverlay(volumeMm, colors)` and `disposeBuildVolumeOverlay(group)` signatures match between Task 2 (definition) and Task 3 (call). `userData.buildVolumeOverlay` tag set in Task 2, read in Task 4. `BuildVolumeColors { edge, grid }` is internal to Task 2 / Task 3.
