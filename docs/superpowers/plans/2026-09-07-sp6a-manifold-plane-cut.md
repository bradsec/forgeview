# SP-6a manifold-3d integration + plane cut - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `manifold-3d` in as a persistent web worker, bridge a `THREE.BufferGeometry` to a `Manifold`, and ship an axis-aligned plane cut that slices the model into two watertight shells in the existing split-parts group, as one undoable "Plane cut" edit.

**Architecture:** New pure `src/services/manifoldBridge.ts` (weld a triangle soup into a manifold vertex set; expand a manifold mesh back to a soup). New `src/services/manifold.worker.ts` holding the wasm across calls. New `src/services/planeCut.ts` (lazy singleton worker + `cutByPlane`). New async `Viewer3D` handle `cutAtPlane()` that reuses `computeClipPlane()` (SP-4c) and the split-parts assembly (SP-2d / `splitByShell`). `AnalysisSection` gains a `viewerRef` and a "Cut at plane" button in the clip block. `HelpModal` entry.

**Tech Stack:** React 19, three.js 0.185, Zustand 5, Vitest 4, Playwright, `manifold-3d` (new, wasm, roadmap-preauthorised).

**Spec:** `docs/superpowers/specs/2026-09-07-sp6a-manifold-plane-cut-design.md`

## Global Constraints

- `manifold-3d` is the ONLY new npm dependency, exact-pinned in `dependencies`, lockfile specifier exact (run `pnpm install` after editing `package.json` so the lockfile re-syncs; a `^`/`~` specifier is a review failure - SP-4b hit this).
- No em dash in prose, comments, JSX text, or commit messages.
- No `@testing-library/jest-dom`. Assert with vitest / React Testing Library core.
- The worker + wasm are dynamically loaded; unit tests never touch them. Only `manifoldBridge.ts`'s pure helpers get unit tests. The worker round trip is covered by the e2e.
- TDD where a task has a unit test: red first, implement, green, full suite, commit.
- Every commit body ends with exactly:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UiM77mQEZ4NcybuEdGMfX5
  ```
- Baseline at plan start: 481 unit tests / 59 files pass, `tsc --noEmit` clean.
- Feature-ship checklist: code + unit tests + a passing e2e + a `HELP_SECTIONS` entry + README / CHANGELOG / roadmap. Tasks 5, 6, 7 cover the last three.

---

### Task 1: dependency + `manifoldBridge.ts` + API spike

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (via `pnpm add`)
- Create: `src/services/manifoldBridge.ts`
- Test: `src/services/manifoldBridge.test.ts`
- Scratch (not committed): a spike script to pin the wasm API

**Interfaces:**
- Produces: `weldSoup(soup: Float32Array): { vertProperties: Float32Array; triVerts: Uint32Array }`, `meshToSoup(vertProperties: Float32Array, triVerts: Uint32Array, numProp: number): Float32Array`.

- [ ] **Step 1: add the dependency.**

```bash
pnpm add manifold-3d
```

Then edit `package.json` so the `manifold-3d` entry is an EXACT version (strip any `^`/`~`), and re-run `pnpm install` so `pnpm-lock.yaml` records `specifier: <exact>`. Confirm with `grep -A1 'manifold-3d' pnpm-lock.yaml`.

- [ ] **Step 2: pin the wasm API with a throwaway spike.** Create `/tmp/manifold-spike.mts` (or under the scratchpad, NOT in `src/`):

```ts
import Module from 'manifold-3d'
const wasm = await Module()
wasm.setup()
const { Manifold, Mesh } = wasm

// unit cube centred on origin, as a welded manifold mesh
const box = Manifold.cube([2, 2, 2], true)
console.log('cube volume', box.volume(), 'genus', box.genus?.() ?? box.numTri())

// which half does trimByPlane keep? cut at x = 0 with normal +X.
const half = box.trimByPlane([1, 0, 0], 0)
const m = half.getMesh()
let minX = Infinity, maxX = -Infinity
for (let v = 0; v < m.numVert; v++) { const x = m.vertProperties[v * m.numProp]; if (x < minX) minX = x; if (x > maxX) maxX = x }
console.log('trimByPlane([1,0,0], 0) keeps x in', minX, '..', maxX)   // expect 0..1 if it keeps the +X side
console.log('mesh fields: numProp', m.numProp, 'numVert', m.numVert, 'numTri', m.numTri, 'triVerts.len', m.triVerts.length, 'vertProperties.len', m.vertProperties.length)
console.log('status of an empty trim', box.trimByPlane([1, 0, 0], 100).isEmpty())
console.log('Mesh ctor + merge: ', typeof new Mesh({ numProp: 3, vertProperties: m.vertProperties, triVerts: m.triVerts }).merge)
box.delete(); half.delete()
```

Run `npx tsx /tmp/manifold-spike.mts`. RECORD in the task report, as the ground truth the later tasks depend on:
- the exact `trimByPlane(normal, offset)` sign convention (which side is kept for `dot(normal, p) - offset >= 0`);
- whether `new Mesh({...})` needs `.merge()` called and whether `new Manifold(mesh)` on an already-welded mesh is valid;
- the `status()` API shape (a `{ value: number }`, an enum, or a method - adjust the worker in Task 2 accordingly);
- `getMesh()` output: `numProp`, `vertProperties` stride, `triVerts` layout.

If the real API differs from the spec's assumptions, note it; Task 2 follows the SPIKE findings, not the spec's guesses.

- [ ] **Step 3: Write the failing test** for the pure bridge helpers:

```ts
import { describe, it, expect } from 'vitest'
import { weldSoup, meshToSoup } from './manifoldBridge'

describe('weldSoup', () => {
  it('merges coincident vertices of a two-triangle quad into 4 unique verts', () => {
    // quad (0,0,0)(1,0,0)(1,1,0) + (0,0,0)(1,1,0)(0,1,0): 6 soup verts, 4 unique
    const soup = new Float32Array([
      0, 0, 0, 1, 0, 0, 1, 1, 0,
      0, 0, 0, 1, 1, 0, 0, 1, 0,
    ])
    const { vertProperties, triVerts } = weldSoup(soup)
    expect(vertProperties.length).toBe(4 * 3)
    expect(triVerts.length).toBe(6)
    // every index is in range and the two shared verts are reused
    expect(Math.max(...triVerts)).toBe(3)
    expect(triVerts[0]).toBe(triVerts[3]) // (0,0,0) shared
    expect(triVerts[2]).toBe(triVerts[4]) // (1,1,0) shared
  })

  it('keeps near-but-not-coincident vertices separate', () => {
    const soup = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      0.5, 0.5, 0.5, 2, 0, 0, 0, 2, 0,
    ])
    const { vertProperties } = weldSoup(soup)
    expect(vertProperties.length).toBe(6 * 3) // nothing merged
  })
})

describe('meshToSoup', () => {
  it('expands indexed manifold output back to a flat non-indexed soup', () => {
    const vertProperties = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])
    const triVerts = new Uint32Array([0, 1, 2, 0, 2, 3])
    const soup = meshToSoup(vertProperties, triVerts, 3)
    expect(soup.length).toBe(6 * 3)
    expect(Array.from(soup.slice(0, 9))).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0])
    expect(Array.from(soup.slice(9, 18))).toEqual([0, 0, 0, 1, 1, 0, 0, 1, 0])
  })

  it('reads only the first 3 of numProp properties per vertex', () => {
    // numProp 5: position + 2 extra floats
    const vertProperties = new Float32Array([1, 2, 3, 9, 9, 4, 5, 6, 9, 9, 7, 8, 9, 9, 9])
    const triVerts = new Uint32Array([0, 1, 2])
    const soup = meshToSoup(vertProperties, triVerts, 5)
    expect(Array.from(soup)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
})
```

- [ ] **Step 4: run red**, then implement `src/services/manifoldBridge.ts`:

```ts
/** Weld a non-indexed triangle soup (9 floats/tri) into a manifold vertex
 *  set: quantise each position onto a fine grid and reuse the index of a
 *  coincident vertex. Manifold needs shared vertices along shared edges. */
export function weldSoup(soup: Float32Array): { vertProperties: Float32Array; triVerts: Uint32Array } {
  const triCount = Math.floor(soup.length / 9)
  // grid ~ 1e-5 of a unit; scale by the bbox so it is relative
  let min = Infinity, max = -Infinity
  for (let i = 0; i < soup.length; i++) {
    const v = soup[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  const span = Math.max(max - min, 1)
  const q = span * 1e-6
  const key = (x: number, y: number, z: number) =>
    Math.round(x / q) + ',' + Math.round(y / q) + ',' + Math.round(z / q)

  const index = new Map<string, number>()
  const verts: number[] = []
  const triVerts = new Uint32Array(triCount * 3)
  for (let t = 0; t < triCount; t++) {
    for (let c = 0; c < 3; c++) {
      const o = t * 9 + c * 3
      const x = soup[o], y = soup[o + 1], z = soup[o + 2]
      const k = key(x, y, z)
      let vi = index.get(k)
      if (vi === undefined) {
        vi = verts.length / 3
        verts.push(x, y, z)
        index.set(k, vi)
      }
      triVerts[t * 3 + c] = vi
    }
  }
  return { vertProperties: new Float32Array(verts), triVerts }
}

/** Expand a manifold mesh (interleaved `vertProperties` with stride `numProp`,
 *  first 3 = position; `triVerts` 3 indices/tri) into a flat non-indexed
 *  position soup, 9 floats/tri. */
export function meshToSoup(vertProperties: Float32Array, triVerts: Uint32Array, numProp: number): Float32Array {
  const triCount = Math.floor(triVerts.length / 3)
  const out = new Float32Array(triCount * 9)
  for (let t = 0; t < triCount; t++) {
    for (let c = 0; c < 3; c++) {
      const vi = triVerts[t * 3 + c]
      const src = vi * numProp
      const dst = t * 9 + c * 3
      out[dst] = vertProperties[src]
      out[dst + 1] = vertProperties[src + 1]
      out[dst + 2] = vertProperties[src + 2]
    }
  }
  return out
}
```

- [ ] **Step 5:** run green, `pnpm exec tsc --noEmit && pnpm test`.

- [ ] **Step 6: Commit** (do NOT commit the spike file):

```bash
git add package.json pnpm-lock.yaml src/services/manifoldBridge.ts src/services/manifoldBridge.test.ts
git commit -m "feat: add manifold-3d; manifoldBridge weld/expand helpers"
```

---

### Task 2: `manifold.worker.ts` + `planeCut.ts`

**Files:**
- Create: `src/services/manifold.worker.ts`
- Create: `src/services/planeCut.ts`

No unit test (worker + wasm). Verification: `tsc --noEmit` clean + full suite no regression.

**Interfaces:**
- Consumes: `weldSoup`, `meshToSoup` from `./manifoldBridge`; `manifold-3d`.
- Produces: `interface PlaneCutResult { partA: Float32Array; partB: Float32Array }`, `cutByPlane(positions: Float32Array, normal: [number, number, number], offset: number): Promise<PlaneCutResult>`.

- [ ] **Step 1: worker.** Write `src/services/manifold.worker.ts` per the spec's code block, ADJUSTED to the Task 1 spike findings:
  - wasm loaded via `import wasmUrl from 'manifold-3d/manifold.wasm?url'` + `Module({ locateFile: () => wasmUrl })`, cached in a module `wasmPromise`.
  - message in: `{ id, positions: ArrayBuffer, normal: [x,y,z], offset: number }`.
  - `weldSoup` the incoming soup, `new Mesh({ numProp: 3, vertProperties, triVerts })`, `.merge()` if the spike says it is needed, `new Manifold(mesh)`.
  - reject (`postMessage({ id, type: 'error', message })`) when the manifold status is bad / empty - use the status API SHAPE the spike found.
  - `a = solid.trimByPlane(normal, offset)`, `b = solid.trimByPlane([-nx,-ny,-nz], -offset)` - the SIGN per the spike (partA keeps `dot(normal,p) - offset >= 0`).
  - `getMesh()` each, `meshToSoup(m.vertProperties, m.triVerts, m.numProp)`, post `{ id, type: 'result', partA, partB }` transferring both `.buffer`s.
  - `.delete()` every `Manifold` and `Mesh`, including on the error paths (`try/finally` or explicit).
  - No em dash in comments.

- [ ] **Step 2: service.** Write `src/services/planeCut.ts` per the spec's code block: a lazy module-singleton `Worker(new URL('./manifold.worker.ts', import.meta.url), { type: 'module' })`, an `id -> {resolve,reject}` pending map, `onmessage` routing `result` / `error`, `onerror` rejecting all pending + nulling the worker, and `cutByPlane` posting a transferred copy of `positions`.

- [ ] **Step 3:** `pnpm exec tsc --noEmit && pnpm test` - clean, 481 tests, no regression. (The worker is not imported by any test; a stray import would pull wasm into jsdom and fail - keep `planeCut.ts` imported only by `Viewer3D.tsx` in Task 3.)

- [ ] **Step 4: Commit**

```bash
git add src/services/manifold.worker.ts src/services/planeCut.ts
git commit -m "feat: manifold plane-cut worker and cutByPlane service"
```

---

### Task 3: Viewer3D `cutAtPlane` handle

**Files:**
- Modify: `src/components/Viewer3D.tsx`
- Modify: `src/components/SceneControls.test.tsx` (mock ripple)

No unit test. Verification: `tsc --noEmit` clean + full suite no regression.

**Interfaces:**
- Consumes: `cutByPlane` from `../services/planeCut`; existing `computeClipPlane`, `withGeometry`, `modelMeshes`, `isRepairable`, `modelGroupRef`, `splitPartsGroupRef`, `splitPartsRef`, `teardownSplitParts`, `teardownXray`, `teardownClip`, `pushUndo`, `applyViewMode`, `updateTriangleDetails`, `updateGeometryDetails`, `refreshSceneEnvironment`, `invalidate`, `disposeModel`, `baseModelName`, `getTheme`.
- Produces: `export type PlaneCutOutcome` and an async `cutAtPlane: () => Promise<PlaneCutOutcome>` handle method.

- [ ] **Step 1: import + type.** `import { cutByPlane } from '../services/planeCut'` by the other `../services/*` imports. Add above `export interface Viewer3DHandle`:

```ts
export type PlaneCutOutcome =
  | { status: 'cut' }
  | { status: 'ineligible'; reason: string }
  | { status: 'empty' }
```

Add `cutAtPlane: () => Promise<PlaneCutOutcome>` to `Viewer3DHandle` (right after `splitByShell`).

- [ ] **Step 2: implement.** Add the `cutAtPlane` method to the `useImperativeHandle` object, next to `splitByShell`. Follow the spec's code block. For the PART ASSEMBLY, read `splitByShell` in the same file and mirror it, with these deltas:
  - the input soup is ALREADY world-space, so each part `THREE.Mesh` is added at position `(0,0,0)`, quaternion identity, scale `1` (do NOT decompose and re-apply `mesh.matrixWorld` the way `splitByShell` does).
  - build each part geometry with `new THREE.BufferGeometry()` + `setAttribute('position', new THREE.BufferAttribute(soup, 3))` + `computeVertexNormals()`.
  - `partMesh.userData.splitPartId = id`, `partMesh.name = \`${baseModelName()} — part ${i + 1}\``, register in `splitPartsRef`, push `partMeta` with `triangleCount: soup.length / 9`, `visible: true`.
  - `scene.remove(original); modelGroupRef.current = undefined; scene.add(group); splitPartsGroupRef.current = group; setSplitParts(partMeta)`.
  - `pushUndo({ label: 'Plane cut', apply: <restore original exactly like splitByShell's apply, plus updateTriangleDetails/updateGeometryDetails/refreshSceneEnvironment/invalidate>, discard: () => disposeModel(original, scene) })`.
  - after: `setXrayMode(false); setClipMode(false)`, `applyViewMode` over `modelRoots()`, `updateTriangleDetails()`, `updateGeometryDetails()`, `refreshSceneEnvironment()`, `invalidate()`, return `{ status: 'cut' }`.
  - The `teardownXray()` / `teardownClip()` calls happen BEFORE the assembly (same as `splitByShell`), and only AFTER `cutByPlane` resolves successfully (do not tear down if the cut errored or was empty).

- [ ] **Step 3: mock ripple.** `src/components/SceneControls.test.tsx` builds a full `satisfies Viewer3DHandle` literal - add `cutAtPlane: vi.fn(),` next to `splitByShell: vi.fn(),`. `tsc --noEmit` flags any other full-handle mock (there is only the one).

- [ ] **Step 4:** `pnpm exec tsc --noEmit && pnpm test` - clean, no previously-passing test now failing.

- [ ] **Step 5: Commit**

```bash
git add src/components/Viewer3D.tsx src/components/SceneControls.test.tsx
git commit -m "feat: Viewer3D - cutAtPlane slices the model into two shells at the clip plane"
```

---

### Task 4: AnalysisSection `viewerRef` + "Cut at plane" button

**Files:**
- Modify: `src/components/prepare/AnalysisSection.tsx`, `src/components/prepare/PreparePanel.tsx`
- Test: `src/components/prepare/AnalysisSection.test.tsx` (adapt renders + add cases)

**Interfaces:**
- Consumes: `viewerRef.current.cutAtPlane()`; store `loadedModels`, `splitParts`, `clipMode`.
- Produces: `AnalysisSection` takes `viewerRef: React.RefObject<Viewer3DHandle | null>`; a "Cut at plane" button + note inside the `{clipMode && (...)}` block.

- [ ] **Step 1: Write the failing test.** In `AnalysisSection.test.tsx`, first change every `render(<AnalysisSection />)` to `render(<AnalysisSection viewerRef={{ current: null }} />)` (and import `Viewer3DHandle` type if the file type-checks the prop). Then append:

```ts
describe('AnalysisSection - plane cut', () => {
  const details = {
    width: 10, height: 10, depth: 10, vertices: 1, meshes: 1,
    boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
    watertight: true, modelUnitInMm: 1, overhangFaceCount: 0, thinWallFaceCount: 0,
  }
  beforeEach(() =>
    useViewerStore.setState({
      geometryDetails: details, clipMode: true, loadedModels: [], splitParts: [],
    }),
  )

  it('calls cutAtPlane and shows nothing extra on success', async () => {
    const cutAtPlane = vi.fn().mockResolvedValue({ status: 'cut' })
    render(<AnalysisSection viewerRef={{ current: { cutAtPlane } as never }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cut at plane' }))
    expect(cutAtPlane).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/plane/i)).not.toBeNull() // the clip label still there, no error note
  })

  it('shows the reason when the cut is ineligible', async () => {
    const cutAtPlane = vi.fn().mockResolvedValue({ status: 'ineligible', reason: 'Undo the current split first' })
    render(<AnalysisSection viewerRef={{ current: { cutAtPlane } as never }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cut at plane' }))
    expect(await screen.findByText('Undo the current split first')).toBeTruthy()
  })

  it('shows a message when the plane misses the model', async () => {
    const cutAtPlane = vi.fn().mockResolvedValue({ status: 'empty' })
    render(<AnalysisSection viewerRef={{ current: { cutAtPlane } as never }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cut at plane' }))
    expect(await screen.findByText('The cut plane does not pass through the model')).toBeTruthy()
  })

  it('disables the button while multi-model or already split', () => {
    useViewerStore.setState({ loadedModels: [{ id: 'a', path: 'a', name: 'a', extension: '.stl', sizeBytes: 1, triangleCount: 1 }] })
    render(<AnalysisSection viewerRef={{ current: null }} />)
    expect((screen.getByRole('button', { name: 'Cut at plane' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
```

- [ ] **Step 2: run red.**

- [ ] **Step 3: Implement.**
  - `PreparePanel.tsx`: change `<AnalysisSection />` to `<AnalysisSection viewerRef={viewerRef} />`.
  - `AnalysisSection.tsx`: add the prop signature `export function AnalysisSection({ viewerRef }: { viewerRef: React.RefObject<Viewer3DHandle | null> })` (import the type from `../Viewer3D`). Add:

```ts
  const multiModel = useViewerStore((s) => s.loadedModels.length > 0)
  const isSplit = useViewerStore((s) => s.splitParts.length > 0)
  const [cutBusy, setCutBusy] = useState(false)
  const [cutNote, setCutNote] = useState<string | null>(null)

  const runCut = async () => {
    setCutBusy(true)
    setCutNote(null)
    try {
      const r = await viewerRef.current?.cutAtPlane()
      if (!r) return
      if (r.status === 'ineligible') setCutNote(r.reason)
      else if (r.status === 'empty') setCutNote('The cut plane does not pass through the model')
    } finally {
      setCutBusy(false)
    }
  }
```

  Inside the existing `{clipMode && ( ... )}` block, after the "Flip side" button, add:

```tsx
            <button
              type="button"
              disabled={!hasModel || multiModel || isSplit || cutBusy}
              onClick={runCut}
              className="px-3 py-1.5 rounded bg-[var(--accent-button)] text-white text-sm self-start disabled:opacity-50"
            >
              {cutBusy ? 'Cutting…' : 'Cut at plane'}
            </button>
            {cutNote && <p className="text-xs text-[var(--text-muted)]">{cutNote}</p>}
```

- [ ] **Step 4:** run green, full suite. Every `AnalysisSection` render in the test file now passes `viewerRef`; fix any that were missed (tsc will flag them).

- [ ] **Step 5: Commit**

```bash
git add src/components/prepare/AnalysisSection.tsx src/components/prepare/PreparePanel.tsx src/components/prepare/AnalysisSection.test.tsx
git commit -m "feat: AnalysisSection - Cut at plane button in the clip controls"
```

---

### Task 5: HELP_SECTIONS entry

**Files:**
- Modify: `src/components/HelpModal.tsx`
- Test: `src/components/HelpModal.test.tsx` (extend)

- [ ] **Step 1: Write the failing test** - add to the "renders the guide" test: `expect(screen.getByRole('heading', { name: 'Plane cut' })).toBeTruthy()`.

- [ ] **Step 2:** run red.

- [ ] **Step 3: Implement** - append to `HELP_SECTIONS`, after "X-ray and clip plane":

```ts
  {
    title: 'Plane cut',
    body: 'With the clip plane shown, Cut at plane slices the model into two watertight shells along that plane. The pieces appear in the Parts section, where you can hide, export, or delete each one. It needs a single-mesh model; run Repair first if the model is not a closed solid. One undoable step.',
  },
```

- [ ] **Step 4:** run green, full suite.

- [ ] **Step 5: Commit**

```bash
git add src/components/HelpModal.tsx src/components/HelpModal.test.tsx
git commit -m "docs: HelpModal - Plane cut feature-guide entry"
```

---

### Task 6: e2e spec (hard completion gate)

**Files:**
- Create: `e2e/plane-cut.spec.ts`

Mirror `e2e/xray-clipping.spec.ts` (inline STL, `DragEvent('drop')`, `.filter({ visible: true })`, `test.skip(isMobile, ...)`, `test.setTimeout(120_000)`). Read any existing split-by-shell e2e for how the Parts section renders (its `data-testid` / heading and how a part row looks) and how an undo entry is clicked (`e2e/auto-orient.spec.ts` / `e2e/transform-panel.spec.ts`).

- [ ] **Step 1: Write the spec.** Fixture: an outward-wound box STL (reuse the `boxStl` from `e2e/bed-layout.spec.ts` or `e2e/transform-panel.spec.ts`). Scenario:
  1. Drop `boxStl(40, 30, 40)`, open Prepare, open the Analysis section (scroll into view; it is a flat section, no accordion).
  2. Click "Show clip plane". Set "Clip position" to `0.5`.
  3. Click "Cut at plane". Wait for the button to leave the "Cutting…" state (`await expect(page.getByRole('button', { name: 'Cut at plane' }).filter({ visible: true })).toBeEnabled()` after it settles) - web-first, no arbitrary timeout.
  4. Assert the Parts section now lists TWO parts (mirror the split-by-shell e2e's part-row locator; if none exists, assert `page.getByText(/part 2/i).filter({ visible: true })` is visible).
  5. Undo the "Plane cut" entry from the undo history, assert the two-part list is gone.

- [ ] **Step 2: Run it.** `npx playwright test e2e/plane-cut.spec.ts`. The first cut pays the wasm init (well within 120 s). Run twice for stability. No retries, no arbitrary waits. If the cut produces a visibly wrong result (one part only, empty scene, a thrown error toast), STOP and report BLOCKED with the console output.

- [ ] **Step 3: Commit**

```bash
git add e2e/plane-cut.spec.ts
git commit -m "test: e2e plane cut splits a box into two parts and undoes"
```

---

### Task 7: docs

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-08-30-print-prep-roadmap.md`

- [ ] **Step 1: README** - a short "Plane cut" bullet by the Split by shell / Repair entries. No em dash.

- [ ] **Step 2: CHANGELOG** - under the current unreleased heading, matching the SP-5c entry format:

```
- Prepare panel: plane cut (SP-6a). With the clip plane shown, Cut at
  plane slices the model into two watertight shells along it, using the
  new manifold-3d wasm worker. The pieces land in the Parts section. One
  undoable step.
```

- [ ] **Step 3: roadmap** - in the "SP-6 decomposition" table, change the SP-6a row to SHIPPED: branch `worktree-sp6a-manifold-plane-cut`, commit range (from `git log`), files (`manifold-3d` dep, `src/services/manifoldBridge.ts`, `src/services/manifold.worker.ts`, `src/services/planeCut.ts`, `src/components/Viewer3D.tsx` `cutAtPlane` handle, `src/components/prepare/AnalysisSection.tsx` button + `viewerRef` prop, `src/components/prepare/PreparePanel.tsx` wiring, `src/components/HelpModal.tsx` entry, `e2e/plane-cut.spec.ts`), spec/plan links. Note SP-6b (booleans) is the remaining SP-6 cycle.

- [ ] **Step 4: Sanity** - `pnpm exec tsc --noEmit && pnpm test`.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md docs/superpowers/specs/2026-08-30-print-prep-roadmap.md
git commit -m "docs: record SP-6a manifold plane cut"
```

---

## Self-Review

**1. Spec coverage:**

| Spec item | Task |
|-----------|------|
| `manifold-3d` dep (exact pin) + `manifoldBridge.ts` weld/expand + wasm API spike | 1 |
| `manifold.worker.ts` (persistent wasm, trimByPlane both sides, `.delete()` discipline) + `planeCut.ts` singleton worker | 2 |
| Viewer3D `cutAtPlane` async handle: clip-plane reuse, world-baked soup, split-parts assembly at identity, "Plane cut" undo, `PlaneCutOutcome` | 3 |
| `SceneControls.test.tsx` mock ripple | 3 |
| AnalysisSection `viewerRef` prop + `PreparePanel` wiring + "Cut at plane" button + note + eligibility gating | 4 |
| `HELP_SECTIONS` entry | 5 |
| e2e hard gate: cut -> two parts -> undo | 6 |
| README / CHANGELOG / roadmap, SP-6b noted | 7 |

Non-goals (booleans, draggable plane, alignment pins, keep-one-side, multi-model cut, progress bar, JS fallback) have no task, as intended.

**2. Placeholder scan:** Task 1 gives the full bridge + full test + the spike script. Task 2 references the spec's worker/service code with an explicit "follow the spike findings" instruction (the manifold API is version-sensitive and cannot be pinned from docs alone - the spike in Task 1 is the mechanism). Task 3 gives the handle shape and points at `splitByShell` for the assembly with an explicit delta list. Task 4 gives the full JSX + handler + the test-render migration.

**3. Type consistency:** `PlaneCutResult { partA, partB }` (service, Task 2) vs `PlaneCutOutcome` (handle, Task 3, a `status` union). `cutByPlane(positions, normal, offset)` matches between Task 2 (definition) and Task 3 (call). `weldSoup` / `meshToSoup` signatures match between Task 1 (definition) and Task 2 (worker use). The cut-plane conversion `manifold offset = -THREE.Plane.constant` is stated in Task 3 and the spec.

**4. Risk note for the executor:** the `manifold-3d` API (`Mesh` constructor fields, `.merge()` necessity, `trimByPlane` sign, `status()` shape, `getMesh()` layout) is pinned by the Task 1 spike, not by this plan. If the spike contradicts a code block here, the spike wins - record the deviation in the ledger and adjust Task 2 / Task 3.
