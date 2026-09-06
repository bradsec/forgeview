# SP-4c X-ray and clipping plane - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two non-destructive interior-inspection view aids to the Prepare panel: an X-ray translucency toggle and an axis-aligned clip plane with adjustable axis, position, and side.

**Architecture:** Pure display state. Store gains `xrayMode` / `clipMode` / `clipAxis` / `clipOffset` / `clipFlip`. `Viewer3D` mutates model-mesh materials in place (`transparent` / `opacity` / `depthWrite` for X-ray; `clippingPlanes` for clip) and restores them from a saved list on disarm, with `renderer.localClippingEnabled = true`. X-ray and clip may be on together but are mutually exclusive with the overhang heatmap, wall-thickness heatmap, and hole-fill (single-flag, disarm-only interlock effects, mirroring SP-4b). `AnalysisSection` grows an "Inspect" group. No geometry, scene-object, `GeometryDetails`, `prepChecks`, or `exporters` change.

**Tech Stack:** React 19, three.js 0.185 (`THREE.Plane`, `renderer.localClippingEnabled` are built in), Zustand 5, Vitest 4, Playwright. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-06-sp4c-xray-clipping-design.md`

## Global Constraints

- No new npm dependency.
- No em dash in prose, comments, JSX text, or commit messages. Use commas, colons, or separate sentences.
- No `@testing-library/jest-dom`. Assert with vitest / React Testing Library core (`.toBeTruthy()`, `.disabled`, store-state reads), matching the existing `AnalysisSection.test.tsx` style.
- TDD: write the failing test first where a task has one, run it red, implement, run green, run the full unit suite, commit.
- Every commit body ends with exactly:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UiM77mQEZ4NcybuEdGMfX5
  ```
- Baseline at plan start: 438 unit tests / 56 files pass, `tsc --noEmit` clean.
- Feature-ship checklist: this cycle ships code + unit tests + a passing e2e + a `HELP_SECTIONS` entry + README / CHANGELOG / roadmap. Tasks 5, 6, 7 cover the last three.

---

### Task 1: store fields + setters + reset

**Files:**
- Modify: `src/store/viewerStore.ts`
- Test: `src/store/viewerStore.test.ts` (extend)

**Interfaces:**
- Produces on the store: `xrayMode: boolean` (default `false`), `clipMode: boolean` (default `false`), `clipAxis: 'x' | 'y' | 'z'` (default `'y'`), `clipOffset: number` (default `0.5`), `clipFlip: boolean` (default `false`); setters `setXrayMode(on: boolean)`, `setClipMode(on: boolean)`, `setClipAxis(axis: 'x' | 'y' | 'z')`, `setClipOffset(t: number)`, `setClipFlip(on: boolean)`.
- `setFile` and `setFileFromBuffer` reset `xrayMode: false, clipMode: false` (NOT `clipAxis` / `clipOffset` / `clipFlip`).

- [ ] **Step 1: Write the failing test** (append to `viewerStore.test.ts`)

```ts
describe('x-ray and clip plane state', () => {
  beforeEach(() =>
    useViewerStore.setState({
      xrayMode: false, clipMode: false, clipAxis: 'y', clipOffset: 0.5, clipFlip: false,
    }),
  )

  it('defaults', () => {
    const s = useViewerStore.getState()
    expect(s.xrayMode).toBe(false)
    expect(s.clipMode).toBe(false)
    expect(s.clipAxis).toBe('y')
    expect(s.clipOffset).toBe(0.5)
    expect(s.clipFlip).toBe(false)
  })

  it('set actions', () => {
    useViewerStore.getState().setXrayMode(true)
    useViewerStore.getState().setClipMode(true)
    useViewerStore.getState().setClipAxis('x')
    useViewerStore.getState().setClipOffset(0.2)
    useViewerStore.getState().setClipFlip(true)
    const s = useViewerStore.getState()
    expect(s.xrayMode).toBe(true)
    expect(s.clipMode).toBe(true)
    expect(s.clipAxis).toBe('x')
    expect(s.clipOffset).toBe(0.2)
    expect(s.clipFlip).toBe(true)
  })

  it('setFile clears the two mode flags but keeps axis, offset, and flip', () => {
    useViewerStore.getState().setXrayMode(true)
    useViewerStore.getState().setClipMode(true)
    useViewerStore.getState().setClipAxis('z')
    useViewerStore.getState().setClipOffset(0.15)
    useViewerStore.getState().setClipFlip(true)
    useViewerStore.getState().setFile('/m.stl', 'm.stl', '.stl', 1)
    const s = useViewerStore.getState()
    expect(s.xrayMode).toBe(false)
    expect(s.clipMode).toBe(false)
    expect(s.clipAxis).toBe('z')
    expect(s.clipOffset).toBe(0.15)
    expect(s.clipFlip).toBe(true)
  })
})
```

- [ ] **Step 2:** run red: `pnpm test src/store/viewerStore.test.ts`.

- [ ] **Step 3: Implement.** In `src/store/viewerStore.ts`, next to the `wallThickness*` fields, add to the state type:

```ts
  xrayMode: boolean
  clipMode: boolean
  clipAxis: 'x' | 'y' | 'z'
  clipOffset: number
  clipFlip: boolean
  setXrayMode: (on: boolean) => void
  setClipMode: (on: boolean) => void
  setClipAxis: (axis: 'x' | 'y' | 'z') => void
  setClipOffset: (t: number) => void
  setClipFlip: (on: boolean) => void
```

In the store initializer, next to `wallThicknessMode: false,` etc.:

```ts
  xrayMode: false,
  clipMode: false,
  clipAxis: 'y',
  clipOffset: 0.5,
  clipFlip: false,
  setXrayMode: (on) => set({ xrayMode: on }),
  setClipMode: (on) => set({ clipMode: on }),
  setClipAxis: (axis) => set({ clipAxis: axis }),
  setClipOffset: (t) => set({ clipOffset: t }),
  setClipFlip: (on) => set({ clipFlip: on }),
```

In BOTH `setFile` and `setFileFromBuffer` `set({ ... })` objects, add `xrayMode: false, clipMode: false,` next to `wallThicknessMode: false,`.

- [ ] **Step 4:** `pnpm exec tsc --noEmit && pnpm test` clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/viewerStore.ts src/store/viewerStore.test.ts
git commit -m "feat: x-ray and clip-plane store state"
```

---

### Task 2: Viewer3D X-ray lifecycle + interlock

**Files:**
- Modify: `src/components/Viewer3D.tsx`

No unit test (jsdom has no WebGL). Verification: `tsc --noEmit` clean + full suite no regression.

**Interfaces:**
- Consumes: existing `withGeometry`, `modelMeshes`, `invalidate`, `rendererGen`, `repairDialogOpen`, `overhangMode`, `wallThicknessMode`, `holeFillMode`; store fields from Task 1.
- Produces: an `xrayRef` + `applyXray` / `teardownXray` helpers; an X-ray lifecycle effect; an X-ray interlock effect; the additive `setXrayMode(false)` in the existing heatmap/hole-fill arm effects; X-ray added to a repair auto-disarm effect.

- [ ] **Step 1: selector + helpers.** Add a `const xrayMode = useViewerStore((s) => s.xrayMode)` selector alongside the wall-thickness selectors (near `Viewer3D.tsx:2017`). Add the ref + helpers next to `teardownWallThicknessOverlay` (near `Viewer3D.tsx:480`):

```ts
  const xrayRef = useRef<
    { mat: THREE.Material; transparent: boolean; opacity: number; depthWrite: boolean }[] | null
  >(null)

  const applyXray = () => {
    teardownXray()
    const seen = new Set<THREE.Material>()
    const saved: { mat: THREE.Material; transparent: boolean; opacity: number; depthWrite: boolean }[] = []
    for (const mesh of withGeometry(modelMeshes())) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const mat of mats) {
        if (!mat || seen.has(mat)) continue
        seen.add(mat)
        saved.push({ mat, transparent: mat.transparent, opacity: mat.opacity, depthWrite: mat.depthWrite })
        mat.transparent = true
        mat.opacity = 0.32
        mat.depthWrite = false
        mat.needsUpdate = true
      }
    }
    xrayRef.current = saved
    invalidate()
  }

  const teardownXray = () => {
    for (const s of xrayRef.current ?? []) {
      s.mat.transparent = s.transparent
      s.mat.opacity = s.opacity
      s.mat.depthWrite = s.depthWrite
      s.mat.needsUpdate = true
    }
    xrayRef.current = null
    invalidate()
  }
```

- [ ] **Step 2: lifecycle effect.** After the wall-thickness Effect 17 (near `Viewer3D.tsx:2048`):

```ts
  // Effect 18: X-ray - lower the model materials' opacity while armed, restore
  // on disarm. Pure material state, no geometry or scene-object change.
  useEffect(() => {
    if (!xrayMode) return
    applyXray()
    return () => {
      teardownXray()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xrayMode, rendererGen])
```

- [ ] **Step 3: interlock.** Add a single-flag disarm-only effect after Effect 18:

```ts
  // Effect 19: X-ray and clip are mutually exclusive with the geometry-swapping
  // modes (overhang heatmap, wall-thickness heatmap, hole-fill), which hide the
  // originals - a translucent or clipped hidden mesh shows nothing. X-ray and
  // clip may be on together. Each effect keys on one flag and only disarms, so
  // the set converges in one pass with no combined dependency and no re-arm.
  useEffect(() => {
    if (xrayMode) {
      useViewerStore.getState().setOverhangMode(false)
      useViewerStore.getState().setWallThicknessMode(false)
      useViewerStore.getState().setHoleFillMode(false)
    }
  }, [xrayMode])
```

Then add `useViewerStore.getState().setXrayMode(false)` inside the EXISTING arm effects, without removing their current bodies:
- the `[overhangMode]` effect (`Viewer3D.tsx:1971-1976`),
- the `[holeFillMode]` effect (`Viewer3D.tsx:1977-1982`),
- the `[wallThicknessMode]` effect (`Viewer3D.tsx:2019-2024`).

- [ ] **Step 4: repair auto-disarm.** Add an effect after Effect 19:

```ts
  // Effect 20: the Repair dialog swaps geometry and materials, so the X-ray
  // restore list would dangle. Disarm on open. (Clip is added here in Task 3.)
  useEffect(() => {
    if (repairDialogOpen && xrayMode) useViewerStore.getState().setXrayMode(false)
  }, [repairDialogOpen, xrayMode])
```

- [ ] **Step 5:** `pnpm exec tsc --noEmit && pnpm test` - clean, 438 tests, no regression.

- [ ] **Step 6: Commit**

```bash
git add src/components/Viewer3D.tsx
git commit -m "feat: Viewer3D x-ray translucency lifecycle and interlock"
```

---

### Task 3: Viewer3D clip-plane lifecycle + interlock

**Files:**
- Modify: `src/components/Viewer3D.tsx`

No unit test. Verification: `tsc --noEmit` clean + full suite no regression.

**Interfaces:**
- Consumes: everything Task 2 consumes, plus `modelRoots`, and `clipMode` / `clipAxis` / `clipOffset` / `clipFlip` from the store.
- Produces: `renderer.localClippingEnabled = true` at both renderer creation sites; a `clipPlaneRef` + `computeClipPlane` / `applyClip` / `teardownClip` helpers; a clip lifecycle effect; a clip-parameter effect; the clip half of the Effect 19 interlock and the Effect 20 repair disarm; additive `setClipMode(false)` in the three heatmap/hole-fill arm effects.

- [ ] **Step 1: renderer flag.** In the initial renderer effect, right after `renderer.setSize(...)` (near `Viewer3D.tsx:1044`), add:

```ts
    renderer.localClippingEnabled = true
```

In the settings-driven `newRenderer` block, right after `newRenderer.setSize(...)` (near `Viewer3D.tsx:1557`), add:

```ts
      newRenderer.localClippingEnabled = true
```

- [ ] **Step 2: selectors + helpers.** Add selectors alongside `xrayMode`:

```ts
  const clipMode = useViewerStore((s) => s.clipMode)
  const clipAxis = useViewerStore((s) => s.clipAxis)
  const clipOffset = useViewerStore((s) => s.clipOffset)
  const clipFlip = useViewerStore((s) => s.clipFlip)
```

Add the ref + helpers next to `teardownXray`:

```ts
  const clipPlaneRef = useRef<{ plane: THREE.Plane; mats: THREE.Material[] } | null>(null)

  const computeClipPlane = (): THREE.Plane | null => {
    const roots = modelRoots()
    if (roots.length === 0) return null
    const box = new THREE.Box3()
    for (const r of roots) {
      r.updateWorldMatrix(true, true)
      box.expandByObject(r)
    }
    if (box.isEmpty()) return null
    const axis = useViewerStore.getState().clipAxis
    const t = useViewerStore.getState().clipOffset
    const flip = useViewerStore.getState().clipFlip
    const cut = THREE.MathUtils.lerp(box.min[axis], box.max[axis], t)
    // THREE.Plane keeps the half-space where normal.dot(p) + constant >= 0.
    // normal = +axis, constant = -cut keeps p[axis] >= cut. flip negates both,
    // which keeps p[axis] <= cut instead.
    const normal = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0)
    if (flip) normal.negate()
    return new THREE.Plane(normal, flip ? cut : -cut)
  }

  const applyClip = () => {
    const plane = computeClipPlane()
    if (!plane) {
      teardownClip()
      return
    }
    const cur = clipPlaneRef.current
    if (cur) {
      cur.plane.copy(plane)
    } else {
      const mats: THREE.Material[] = []
      const seen = new Set<THREE.Material>()
      for (const mesh of withGeometry(modelMeshes())) {
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const mat of list) {
          if (!mat || seen.has(mat)) continue
          seen.add(mat)
          mat.clippingPlanes = [plane]
          mat.clipShadows = true
          mats.push(mat)
        }
      }
      clipPlaneRef.current = { plane, mats }
    }
    invalidate()
  }

  const teardownClip = () => {
    for (const mat of clipPlaneRef.current?.mats ?? []) {
      mat.clippingPlanes = null
      mat.clipShadows = false
    }
    clipPlaneRef.current = null
    invalidate()
  }
```

- [ ] **Step 3: lifecycle + parameter effects.** After Effect 18 (X-ray):

```ts
  // Effect 21: Clip plane - assign an axis-aligned THREE.Plane to the model
  // materials while armed, clear it on disarm.
  useEffect(() => {
    if (!clipMode) return
    applyClip()
    return () => {
      teardownClip()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipMode, rendererGen])

  // Effect 22: Recompute the plane in place when axis, position, or side
  // changes. applyClip's reuse branch just moves the existing plane, so a
  // slider drag is not a material-array churn.
  useEffect(() => {
    if (clipMode) applyClip()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipAxis, clipOffset, clipFlip])
```

- [ ] **Step 4: interlock + repair disarm.** Extend Effect 19 (the X-ray interlock) with a sibling clip effect right after it:

```ts
  useEffect(() => {
    if (clipMode) {
      useViewerStore.getState().setOverhangMode(false)
      useViewerStore.getState().setWallThicknessMode(false)
      useViewerStore.getState().setHoleFillMode(false)
    }
  }, [clipMode])
```

Add `useViewerStore.getState().setClipMode(false)` alongside the `setXrayMode(false)` line in each of the three existing arm effects (`[overhangMode]`, `[holeFillMode]`, `[wallThicknessMode]`).

Extend Effect 20 (repair auto-disarm) to also disarm clip:

```ts
  useEffect(() => {
    if (repairDialogOpen && xrayMode) useViewerStore.getState().setXrayMode(false)
    if (repairDialogOpen && clipMode) useViewerStore.getState().setClipMode(false)
  }, [repairDialogOpen, xrayMode, clipMode])
```

- [ ] **Step 5:** `pnpm exec tsc --noEmit && pnpm test` - clean, 438 tests, no regression.

- [ ] **Step 6: Commit**

```bash
git add src/components/Viewer3D.tsx
git commit -m "feat: Viewer3D axis-aligned clip plane lifecycle and interlock"
```

---

### Task 4: AnalysisSection "Inspect" group

**Files:**
- Modify: `src/components/prepare/AnalysisSection.tsx`
- Test: `src/components/prepare/AnalysisSection.test.tsx` (extend)

**Interfaces:**
- Consumes: store `xrayMode`, `clipMode`, `clipAxis`, `clipOffset`, `clipFlip`, `setXrayMode`, `setClipMode`, `setClipAxis`, `setClipOffset`, `setClipFlip`, plus the existing `hasModel`.
- Produces: below the wall-thickness block, an X-ray toggle, a clip toggle, and (only while `clipMode`) an axis 3-button group, a position range input, and a flip toggle. Intro `<p>` text updated.

- [ ] **Step 1: Write the failing test** (append to `AnalysisSection.test.tsx`)

```ts
describe('AnalysisSection - inspect (x-ray and clip)', () => {
  const details = {
    width: 10, height: 10, depth: 10, vertices: 1, meshes: 1,
    boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
    watertight: true, modelUnitInMm: 1, overhangFaceCount: 0, thinWallFaceCount: 0,
  }

  beforeEach(() =>
    useViewerStore.setState({
      geometryDetails: details,
      overhangMode: false, wallThicknessMode: false,
      xrayMode: false, clipMode: false, clipAxis: 'y', clipOffset: 0.5, clipFlip: false,
    }),
  )

  it('toggles x-ray', async () => {
    render(<AnalysisSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Show X-ray' }))
    expect(useViewerStore.getState().xrayMode).toBe(true)
  })

  it('shows the clip controls only while clip is armed', async () => {
    render(<AnalysisSection />)
    expect(screen.queryByLabelText('Clip position')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Show clip plane' }))
    expect(useViewerStore.getState().clipMode).toBe(true)
    expect(screen.getByLabelText('Clip position')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'X' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Z' })).toBeTruthy()
  })

  it('commits axis, position, and flip changes', async () => {
    useViewerStore.setState({ clipMode: true })
    render(<AnalysisSection />)
    await userEvent.click(screen.getByRole('button', { name: 'X' }))
    expect(useViewerStore.getState().clipAxis).toBe('x')
    fireEvent.change(screen.getByLabelText('Clip position'), { target: { value: '0.25' } })
    expect(useViewerStore.getState().clipOffset).toBeCloseTo(0.25)
    await userEvent.click(screen.getByRole('button', { name: 'Flip side' }))
    expect(useViewerStore.getState().clipFlip).toBe(true)
  })

  it('disables both toggles without a model', () => {
    useViewerStore.setState({ geometryDetails: null })
    render(<AnalysisSection />)
    expect((screen.getByRole('button', { name: 'Show X-ray' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Show clip plane' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
```

Ensure `fireEvent` is imported from `@testing-library/react` in this file (add to the existing import if missing).

- [ ] **Step 2:** run red.

- [ ] **Step 3: Implement.** Read the current `AnalysisSection.tsx`. It has an overhang block and a wall-thickness block, each with an `aria-label`ed input and an `aria-pressed` toggle. Add selectors near the others:

```ts
  const xrayMode = useViewerStore((s) => s.xrayMode)
  const clipMode = useViewerStore((s) => s.clipMode)
  const clipAxis = useViewerStore((s) => s.clipAxis)
  const clipOffset = useViewerStore((s) => s.clipOffset)
  const clipFlip = useViewerStore((s) => s.clipFlip)
```

Update the intro `<p>` text to exactly:

```
Highlight downward-facing overhangs and thin walls, or look inside with X-ray and a clip plane.
```

After the wall-thickness block's closing `)}` for the unsampled / not-eligible notes and before the outer `</div>`, add:

```tsx
        <button
          type="button"
          disabled={!hasModel}
          aria-pressed={xrayMode}
          onClick={() => useViewerStore.getState().setXrayMode(!xrayMode)}
          className={
            'px-3 py-1.5 rounded text-sm self-start disabled:opacity-50 ' +
            (xrayMode ? 'bg-[var(--accent-button)] text-white' : 'bg-[var(--bg-button)]')
          }
        >
          {xrayMode ? 'Hide X-ray' : 'Show X-ray'}
        </button>
        <button
          type="button"
          disabled={!hasModel}
          aria-pressed={clipMode}
          onClick={() => useViewerStore.getState().setClipMode(!clipMode)}
          className={
            'px-3 py-1.5 rounded text-sm self-start disabled:opacity-50 ' +
            (clipMode ? 'bg-[var(--accent-button)] text-white' : 'bg-[var(--bg-button)]')
          }
        >
          {clipMode ? 'Hide clip plane' : 'Show clip plane'}
        </button>
        {clipMode && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Clip axis</span>
              {(['x', 'y', 'z'] as const).map((ax) => (
                <button
                  key={ax}
                  type="button"
                  disabled={!hasModel}
                  aria-pressed={clipAxis === ax}
                  onClick={() => useViewerStore.getState().setClipAxis(ax)}
                  className={
                    'px-2 py-1 rounded text-sm disabled:opacity-50 ' +
                    (clipAxis === ax ? 'bg-[var(--accent-button)] text-white' : 'bg-[var(--bg-button)]')
                  }
                >
                  {ax.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Clip position</span>
              <input
                aria-label="Clip position"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={clipOffset}
                disabled={!hasModel}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (Number.isFinite(n)) useViewerStore.getState().setClipOffset(n)
                }}
                className="flex-1"
              />
            </div>
            <button
              type="button"
              disabled={!hasModel}
              aria-pressed={clipFlip}
              onClick={() => useViewerStore.getState().setClipFlip(!clipFlip)}
              className={
                'px-3 py-1.5 rounded text-sm self-start disabled:opacity-50 ' +
                (clipFlip ? 'bg-[var(--accent-button)] text-white' : 'bg-[var(--bg-button)]')
              }
            >
              Flip side
            </button>
          </div>
        )}
```

- [ ] **Step 4:** run green, full suite.

- [ ] **Step 5: Commit**

```bash
git add src/components/prepare/AnalysisSection.tsx src/components/prepare/AnalysisSection.test.tsx
git commit -m "feat: AnalysisSection inspect group - x-ray and clip-plane controls"
```

---

### Task 5: HELP_SECTIONS entry

**Files:**
- Modify: `src/components/HelpModal.tsx`
- Test: `src/components/HelpModal.test.tsx` (extend)

- [ ] **Step 1: Write the failing test** - add to the "renders the guide" test: `expect(screen.getByRole('heading', { name: 'X-ray and clip plane' })).toBeTruthy()`.

- [ ] **Step 2:** run red.

- [ ] **Step 3: Implement** - append to `HELP_SECTIONS`, after "Wall thickness heatmap":

```ts
  {
    title: 'X-ray and clip plane',
    body: 'X-ray makes the model translucent so you can see interior walls and trapped voids. The clip plane hides everything on one side of an adjustable X, Y, or Z cut, showing a live cross-section. Use both to check what Make solid or hollow produced. They turn off automatically when a heatmap or hole-fill is armed.',
  },
```

- [ ] **Step 4:** run green, full suite.

- [ ] **Step 5: Commit**

```bash
git add src/components/HelpModal.tsx src/components/HelpModal.test.tsx
git commit -m "docs: HelpModal - X-ray and clip plane feature-guide entry"
```

---

### Task 6: e2e spec (hard completion gate)

**Files:**
- Create: `e2e/xray-clipping.spec.ts`

Mirror `e2e/wall-thickness-heatmap.spec.ts` (read it): inline STL + `DragEvent('drop')`, `.filter({ visible: true })` on every panel/tab/toolbar/testid locator, `test.skip(isMobile, ...)`, `test.setTimeout(120_000)`, the `showSaveFilePicker` init-script, the File-menu export flow.

**Fixture:** a plain unit cube STL (12 triangles). No thin-wall geometry needed.

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

test.describe('X-ray and clip plane', () => {
  test('toggles x-ray and clip, adjusts the plane, interlocks with a heatmap, and exports', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Inspect flow verified on desktop')
    test.setTimeout(120_000)
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
    })

    await dropStl(page, cubeStl(), 'cube.stl')
    await page.getByRole('button', { name: 'Prepare' }).filter({ visible: true }).click()

    const xrayShow = page.getByRole('button', { name: 'Show X-ray' }).filter({ visible: true })
    const clipShow = page.getByRole('button', { name: 'Show clip plane' }).filter({ visible: true })

    await xrayShow.click()
    await expect(page.getByRole('button', { name: 'Hide X-ray' }).filter({ visible: true })).toBeVisible()

    await clipShow.click()
    await expect(page.getByRole('button', { name: 'Hide clip plane' }).filter({ visible: true })).toBeVisible()
    const pos = page.getByLabel('Clip position').filter({ visible: true })
    await expect(pos).toBeVisible()
    await pos.fill('0.25')
    await page.getByRole('button', { name: 'X', exact: true }).filter({ visible: true }).click()
    await page.getByRole('button', { name: 'Flip side' }).filter({ visible: true }).click()
    await expect(page.getByRole('button', { name: 'Hide clip plane' }).filter({ visible: true })).toBeVisible()

    // Arming a heatmap disarms both inspect aids (interlock).
    await page.getByRole('button', { name: 'Show overhang heatmap' }).filter({ visible: true }).click()
    await expect(page.getByRole('button', { name: 'Show X-ray' }).filter({ visible: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Show clip plane' }).filter({ visible: true })).toBeVisible()

    // Re-arm x-ray, export.
    await page.getByRole('button', { name: 'Show X-ray' }).filter({ visible: true }).click()
    await expect(page.getByRole('button', { name: 'Hide X-ray' }).filter({ visible: true })).toBeVisible()
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

- [ ] **Step 2: Run it.** `npx playwright test e2e/xray-clipping.spec.ts`. Adjust selectors to the real DOM if the X-ray / clip button names, the "Clip position" label, or the axis button names differ from this draft (the source of truth is `e2e/wall-thickness-heatmap.spec.ts` + `AnalysisSection.tsx`). Run twice for stability. No retries, no arbitrary waits. If a genuine product bug surfaces (a clip plane throws, the interlock does not fire), STOP and report BLOCKED.

- [ ] **Step 3: Commit**

```bash
git add e2e/xray-clipping.spec.ts
git commit -m "test: e2e x-ray and clip-plane toggles, plane adjust, interlock, export"
```

---

### Task 7: docs

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-08-30-print-prep-roadmap.md`

- [ ] **Step 1: README** - add a short "X-ray and clip plane" entry near the heatmap entries, matching the file's bullet style. No em dash.

- [ ] **Step 2: CHANGELOG** - under the current unreleased / next-version heading, matching the SP-4a / SP-4b entry format:

```
- Prepare panel: X-ray and clip plane (SP-4c). X-ray makes the model
  translucent; the clip plane hides one side of an adjustable X, Y, or Z
  cut for a live cross-section. Both are mutually exclusive with the
  overhang and wall-thickness heatmaps and hole-fill.
```

- [ ] **Step 3: roadmap** - extend the "SP-4 decomposition" table: SP-4c row -> SHIPPED, branch `worktree-sp4c-xray-clipping`, commit range (from `git log`), files (`viewerStore.ts` fields, `Viewer3D.tsx` x-ray + clip lifecycle/interlock, `AnalysisSection.tsx` inspect group, `HelpModal.tsx` entry, `e2e/xray-clipping.spec.ts`), spec/plan links. Add a line that SP-4 (analysis heatmaps) is now complete.

- [ ] **Step 4: Sanity** - `pnpm exec tsc --noEmit && pnpm test`.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md docs/superpowers/specs/2026-08-30-print-prep-roadmap.md
git commit -m "docs: record SP-4c x-ray and clip plane"
```

---

## Self-Review

**1. Spec coverage:**

| Spec item | Task |
|-----------|------|
| Store: `xrayMode`, `clipMode`, `clipAxis`, `clipOffset`, `clipFlip` + setters + `setFile` reset | 1 |
| X-ray: in-place material mutation, saved-list restore, dedupe by material | 2 |
| X-ray lifecycle effect + interlock + repair disarm | 2 |
| `renderer.localClippingEnabled = true` at both renderer sites | 3 |
| Clip: `computeClipPlane` (normalised offset, flip sign), `applyClip` reuse branch, `teardownClip` | 3 |
| Clip lifecycle effect + parameter effect + interlock + repair disarm | 3 |
| AnalysisSection inspect group (x-ray toggle, clip toggle, axis / position / flip, intro copy) | 4 |
| `HELP_SECTIONS` entry | 5 |
| e2e hard gate incl. interlock | 6 |
| README / CHANGELOG / roadmap, SP-4 marked complete | 7 |

Non-goals (capped section, plane gizmo, per-part clip, persisted state, Fresnel shader, stripping X-ray from exports) have no task, as intended.

**2. Placeholder scan:** No "TBD". Tasks 1, 4, 5, 6 give full test code; Tasks 2, 3 give the full helper and effect code with the exact insertion anchors; Task 4 gives the full JSX.

**3. Type consistency:** `clipAxis: 'x' | 'y' | 'z'` used identically in Tasks 1, 3, 4. `clipOffset: number` (0..1) in Tasks 1, 3, 4. Store setters `setXrayMode` / `setClipMode` / `setClipAxis` / `setClipOffset` / `setClipFlip` consistent across Tasks 1, 2, 3, 4. `xrayRef` shape `{ mat, transparent, opacity, depthWrite }[]` and `clipPlaneRef` shape `{ plane, mats }` are internal to Task 2 / Task 3. Interlock: every new effect keys on a single flag (`[xrayMode]`, `[clipMode]`) and only disarms, matching SP-4b Effects 10h..10j.
