# SP-5b Auto-orient - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One "Auto-orient" button that searches candidate rest orientations, scores each on downward-facing overhang area (plus height and bed-contact tie-breakers), rotates the model to the best one, drops it to the floor and centres it on the plate as one undoable step, and reports the overhang-area change.

**Architecture:** New pure service `src/services/autoOrient.ts` (`fibonacciSphere`, `computeBestOrientation`). New `Viewer3D` handle method `autoOrient()` that merges the world-baked geometry, calls the search, premultiplies the winning quaternion onto each model root, then drops to floor + centres, and pushes one undo entry. A button + result note in `TransformSection`. `HelpModal` entry. No store field, no `prepChecks` change, no interlock: the existing `updateGeometryDetails` + `refreshSceneEnvironment` calls make the Overhangs / On build plate rows and any overlays reflect the new orientation.

**Tech Stack:** React 19, three.js 0.185 (`Quaternion.setFromUnitVectors`, `Vector3`, `Box3` built in), Zustand 5, Vitest 4, Playwright. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-07-sp5b-auto-orient-design.md`

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
- Baseline at plan start: 457 unit tests / 57 files pass, `tsc --noEmit` clean.
- Feature-ship checklist: this cycle ships code + unit tests + a passing e2e + a `HELP_SECTIONS` entry + README / CHANGELOG / roadmap. Tasks 4, 5, 6 cover the last three.

---

### Task 1: `autoOrient.ts` orientation search

**Files:**
- Create: `src/services/autoOrient.ts`
- Test: `src/services/autoOrient.test.ts`

**Interfaces:**
- Produces: `AUTO_ORIENT_CANDIDATES` (128), `AUTO_ORIENT_MAX_FACES` (200_000), `interface AutoOrientResult { quaternion: [number, number, number, number]; overhangFractionBefore: number; overhangFractionAfter: number; candidatesEvaluated: number; skipped: boolean }`, `fibonacciSphere(n: number): [number, number, number][]`, `computeBestOrientation(positions: Float32Array, thresholdDeg: number): AutoOrientResult`.
- Consumed by: Task 2 (Viewer3D).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  fibonacciSphere,
  computeBestOrientation,
  AUTO_ORIENT_CANDIDATES,
  AUTO_ORIENT_MAX_FACES,
} from './autoOrient'

/** Two triangles forming a quad, tilted `deg` from horizontal about the X axis,
 *  so the underside faces down at `deg` from straight down. */
function tiltedPlate(deg: number): Float32Array {
  const t = (deg * Math.PI) / 180
  const dy = Math.sin(t) * 10
  const dz = Math.cos(t) * 10
  // corners: (0,0,0) (10,0,0) (10,dy,dz) (0,dy,dz)
  const a = [0, 0, 0], b = [10, 0, 0], c = [10, dy, dz], d = [0, dy, dz]
  return new Float32Array([...a, ...b, ...c, ...a, ...c, ...d])
}

describe('fibonacciSphere', () => {
  it('returns n unit vectors', () => {
    const pts = fibonacciSphere(64)
    expect(pts.length).toBe(64)
    for (const [x, y, z] of pts) {
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5)
    }
  })
})

describe('computeBestOrientation', () => {
  it('leaves a level plate alone (identity quaternion, no-op)', () => {
    const level = tiltedPlate(0)
    const r = computeBestOrientation(level, 45)
    expect(r.skipped).toBe(false)
    // already flat: winner is the current orientation -> identity
    expect(r.quaternion).toEqual([0, 0, 0, 1])
    expect(r.overhangFractionAfter).toBeCloseTo(r.overhangFractionBefore, 5)
  })

  it('finds an orientation that removes the overhang on a tilted plate', () => {
    const tilted = tiltedPlate(30) // underside 30 deg from straight down -> overhang at threshold 45
    const r = computeBestOrientation(tilted, 45)
    expect(r.skipped).toBe(false)
    expect(r.overhangFractionBefore).toBeGreaterThan(0.4) // most of the area is the tilted underside
    expect(r.overhangFractionAfter).toBeLessThan(r.overhangFractionBefore)
    // Applying the returned quaternion should bring the winning face near level.
    const q = new THREE.Quaternion(...r.quaternion)
    // rotate the tilted plate's first-face normal and check it is closer to +-Y
    const n = new THREE.Vector3(0, -Math.cos((30 * Math.PI) / 180), Math.sin((30 * Math.PI) / 180)).applyQuaternion(q)
    expect(Math.abs(n.y)).toBeGreaterThan(0.9)
  })

  it('skips a model over the face cap', () => {
    // AUTO_ORIENT_MAX_FACES + 1 degenerate-free triangles
    const faces = AUTO_ORIENT_MAX_FACES + 1
    const pos = new Float32Array(faces * 9)
    for (let f = 0; f < faces; f++) {
      const o = f * 9
      pos[o] = 0; pos[o + 1] = 0; pos[o + 2] = 0
      pos[o + 3] = 1; pos[o + 4] = 0; pos[o + 5] = 0
      pos[o + 6] = 0; pos[o + 7] = 1; pos[o + 8] = 0
    }
    const r = computeBestOrientation(pos, 45)
    expect(r.skipped).toBe(true)
    expect(r.quaternion).toEqual([0, 0, 0, 1])
    expect(r.candidatesEvaluated).toBe(0)
    expect(Number.isFinite(r.overhangFractionBefore)).toBe(true)
  })

  it('candidatesEvaluated is the candidate count plus the current orientation', () => {
    const r = computeBestOrientation(tiltedPlate(10), 45)
    expect(r.candidatesEvaluated).toBe(AUTO_ORIENT_CANDIDATES + 1)
  })
})
```

- [ ] **Step 2:** run red: `pnpm test src/services/autoOrient.test.ts`.

- [ ] **Step 3: Implement** `src/services/autoOrient.ts`:

```ts
import * as THREE from 'three'

export const AUTO_ORIENT_CANDIDATES = 128
export const AUTO_ORIENT_MAX_FACES = 200_000

const DEGENERATE_EPSILON = 1e-10
const W_OVERHANG = 1.0
const W_HEIGHT = 0.2
const W_CONTACT = 0.15
const CONTACT_NORMAL_MIN = 0.985

export interface AutoOrientResult {
  quaternion: [number, number, number, number]
  overhangFractionBefore: number
  overhangFractionAfter: number
  candidatesEvaluated: number
  skipped: boolean
}

/** n roughly-uniform unit vectors on the sphere (Fibonacci lattice). */
export function fibonacciSphere(n: number): [number, number, number][] {
  const out: [number, number, number][] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * i
    out.push([Math.cos(theta) * r, y, Math.sin(theta) * r])
  }
  return out
}

/**
 * `positions` is a WORLD-SPACE, NON-INDEXED triangle soup (9 floats/face) -
 * the merged current geometry of every model mesh. `thresholdDeg` is the
 * overhang angle from straight down (same value the Overhangs row uses).
 * A face is a downward-facing overhang for a candidate down-vector `d` when
 * dot(unitNormal, d) > cos(thresholdDeg).
 */
export function computeBestOrientation(
  positions: Float32Array,
  thresholdDeg: number,
): AutoOrientResult {
  const faceCount = Math.floor(positions.length / 9)
  const cosThreshold = Math.cos((thresholdDeg * Math.PI) / 180)

  // Per-face unit normal + area, one pass. Degenerate faces get area 0 and a
  // zero normal so they never count as overhang or contact.
  const normals = new Float32Array(faceCount * 3)
  const areas = new Float32Array(faceCount)
  let totalArea = 0
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let f = 0; f < faceCount; f++) {
    const o = f * 9
    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2]
    const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5]
    const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8]
    for (const [vx, vy, vz] of [[ax, ay, az], [bx, by, bz], [cx, cy, cz]] as const) {
      if (vx < minX) minX = vx; if (vx > maxX) maxX = vx
      if (vy < minY) minY = vy; if (vy > maxY) maxY = vy
      if (vz < minZ) minZ = vz; if (vz > maxZ) maxZ = vz
    }
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az
    const nx = e1y * e2z - e1z * e2y
    const ny = e1z * e2x - e1x * e2z
    const nz = e1x * e2y - e1y * e2x
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len < DEGENERATE_EPSILON) continue
    normals[f * 3] = nx / len
    normals[f * 3 + 1] = ny / len
    normals[f * 3 + 2] = nz / len
    const area = len / 2
    areas[f] = area
    totalArea += area
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1

  // Evaluate one candidate down-vector: returns its overhang fraction (support
  // needing, i.e. within thresholdDeg of straight down and NOT resting on the
  // plate), contact fraction, normalised height, and the weighted cost.
  const evalCandidate = (dx: number, dy: number, dz: number) => {
    const upx = -dx, upy = -dy, upz = -dz
    let minH = Infinity
    let maxH = -Infinity
    for (let f = 0; f < faceCount; f++) {
      const o = f * 9
      for (let v = 0; v < 3; v++) {
        const h = positions[o + v * 3] * upx + positions[o + v * 3 + 1] * upy + positions[o + v * 3 + 2] * upz
        if (h < minH) minH = h
        if (h > maxH) maxH = h
      }
    }
    const height = maxH - minH
    const contactEps = Math.max(height * 1e-3, 1e-4)
    let overhangArea = 0
    let contactArea = 0
    for (let f = 0; f < faceCount; f++) {
      if (areas[f] === 0) continue
      const nd = normals[f * 3] * dx + normals[f * 3 + 1] * dy + normals[f * 3 + 2] * dz
      // Bed contact: near-straight-down normal AND all 3 vertices on the
      // lowest plane along this build axis.
      let isContact = false
      if (nd > CONTACT_NORMAL_MIN) {
        const o = f * 9
        isContact = true
        for (let v = 0; v < 3; v++) {
          const h = positions[o + v * 3] * upx + positions[o + v * 3 + 1] * upy + positions[o + v * 3 + 2] * upz
          if (h - minH > contactEps) { isContact = false; break }
        }
      }
      if (isContact) contactArea += areas[f]
      // Support-needing overhang: within thresholdDeg of straight down AND
      // not resting on the plate. Excluding the contact set is what makes
      // "rest it flat" the low-overhang answer instead of "stand it on edge".
      else if (nd > cosThreshold) overhangArea += areas[f]
    }
    const overhangFraction = totalArea > 0 ? overhangArea / totalArea : 0
    const contactFraction = totalArea > 0 ? contactArea / totalArea : 0
    const heightNorm = height / diag
    const cost = W_OVERHANG * overhangFraction + W_HEIGHT * heightNorm - W_CONTACT * contactFraction
    return { overhangFraction, cost }
  }

  const base = evalCandidate(0, -1, 0)
  const before = base.overhangFraction

  if (faceCount > AUTO_ORIENT_MAX_FACES) {
    return {
      quaternion: [0, 0, 0, 1],
      overhangFractionBefore: before,
      overhangFractionAfter: before,
      candidatesEvaluated: 0,
      skipped: true,
    }
  }

  const dirs = fibonacciSphere(AUTO_ORIENT_CANDIDATES)
  let bestDir: [number, number, number] | null = null
  let bestCost = base.cost
  let bestOverhang = before

  for (const [dx, dy, dz] of dirs) {
    const c = evalCandidate(dx, dy, dz)
    // Strictly better than the current orientation to switch, so a tie keeps
    // the current orientation and the result is a no-op.
    if (c.cost < bestCost - 1e-9) {
      bestCost = c.cost
      bestDir = [dx, dy, dz]
      bestOverhang = c.overhangFraction
    }
  }

  let quaternion: [number, number, number, number] = [0, 0, 0, 1]
  if (bestDir) {
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(bestDir[0], bestDir[1], bestDir[2]),
      new THREE.Vector3(0, -1, 0),
    )
    quaternion = [q.x, q.y, q.z, q.w]
  }

  return {
    quaternion,
    overhangFractionBefore: before,
    overhangFractionAfter: bestDir ? bestOverhang : before,
    candidatesEvaluated: AUTO_ORIENT_CANDIDATES + 1,
    skipped: false,
  }
}
```

Note: `evalCandidate` runs two face loops (height extent, then overhang and
contact). That is `2 * (AUTO_ORIENT_CANDIDATES + 1) * faceCount` iterations,
about 52 million at the 200k-face cap, sub-second in JS. Do not pre-emptively
fold the two loops together; if a reviewer flags the double pass, a running
`minH`/`maxH` with a deferred contact test is an acceptable follow-up.

- [ ] **Step 4:** run green, full suite: `pnpm exec tsc --noEmit && pnpm test`.

- [ ] **Step 5: Commit**

```bash
git add src/services/autoOrient.ts src/services/autoOrient.test.ts
git commit -m "feat: autoOrient - orientation search over overhang area, height, contact"
```

---

### Task 2: Viewer3D `autoOrient()` handle

**Files:**
- Modify: `src/components/Viewer3D.tsx`

No unit test (jsdom has no WebGL). Verification: `tsc --noEmit` clean + full suite no regression (baseline may rise by the Task 1 test count; treat "no regression" as no previously-passing test now failing).

**Interfaces:**
- Consumes: `computeBestOrientation` + `AutoOrientResult` from `../services/autoOrient`; existing `modelRoots`, `modelMeshes`, `withGeometry`, `pushUndo`, `updateGeometryDetails`, `refreshSceneEnvironment`, `invalidate`, and the store's `overhangThresholdDeg`.
- Produces: `export type AutoOrientOutcome` and a new `autoOrient: () => AutoOrientOutcome` method on `Viewer3DHandle`.

- [ ] **Step 1: import + type.** Add the import next to the other `../services/*` imports (near line 34-38):

```ts
import { computeBestOrientation } from '../services/autoOrient'
```

Add the outcome type just above `export interface Viewer3DHandle {` (line 49):

```ts
export type AutoOrientOutcome =
  | { status: 'applied'; beforePct: number; afterPct: number }
  | { status: 'noop' }
  | { status: 'skipped' }
  | { status: 'empty' }
```

Add to the `Viewer3DHandle` interface, right after `centerOnPlate: () => void` (line 88):

```ts
  autoOrient: () => AutoOrientOutcome
```

- [ ] **Step 2: implement.** Insert the method in the `useImperativeHandle` object between `centerOnPlate`'s closing `},` (line 908) and `runRepair:` (line 909):

```ts
    autoOrient: () => {
      const roots = modelRoots()
      if (roots.length === 0) return { status: 'empty' as const }

      const meshes = withGeometry(modelMeshes())
      const chunks: Float32Array[] = []
      for (const mesh of meshes) {
        mesh.updateWorldMatrix(true, false)
        const g = mesh.geometry as THREE.BufferGeometry
        const wg = g.index ? g.toNonIndexed() : g.clone()
        wg.applyMatrix4(mesh.matrixWorld)
        chunks.push((wg.getAttribute('position') as THREE.BufferAttribute).array as Float32Array)
        wg.dispose()
      }
      const total = chunks.reduce((n, c) => n + c.length, 0)
      if (total === 0) return { status: 'empty' as const }
      const positions = new Float32Array(total)
      let off = 0
      for (const c of chunks) { positions.set(c, off); off += c.length }

      const threshold = useViewerStore.getState().overhangThresholdDeg
      const res = computeBestOrientation(positions, threshold)
      if (res.skipped) return { status: 'skipped' as const }

      const q = new THREE.Quaternion(
        res.quaternion[0], res.quaternion[1], res.quaternion[2], res.quaternion[3],
      )
      const isIdentity = q.x === 0 && q.y === 0 && q.z === 0 && Math.abs(q.w) === 1
      if (isIdentity) return { status: 'noop' as const }

      const prevQuat = roots.map((r) => r.quaternion.clone())
      const prevPos = roots.map((r) => r.position.clone())

      roots.forEach((r) => r.quaternion.premultiply(q))
      const box = new THREE.Box3()
      for (const r of roots) box.expandByObject(r)
      const dy = -box.min.y
      const center = box.getCenter(new THREE.Vector3())
      roots.forEach((r) => {
        r.position.y += dy
        r.position.x += -center.x
        r.position.z += -center.z
      })

      pushUndo({
        label: 'Auto-orient',
        apply: () => {
          modelRoots().forEach((r, i) => {
            if (prevQuat[i]) r.quaternion.copy(prevQuat[i])
            if (prevPos[i]) r.position.copy(prevPos[i])
          })
          updateGeometryDetails()
          refreshSceneEnvironment()
          invalidate()
        },
        discard: () => {},
      })
      updateGeometryDetails()
      refreshSceneEnvironment()
      invalidate()

      return {
        status: 'applied' as const,
        beforePct: Math.round(res.overhangFractionBefore * 100),
        afterPct: Math.round(res.overhangFractionAfter * 100),
      }
    },
```

- [ ] **Step 3:** `pnpm exec tsc --noEmit && pnpm test` - clean, no previously-passing test now failing.

- [ ] **Step 4: Commit**

```bash
git add src/components/Viewer3D.tsx
git commit -m "feat: Viewer3D - autoOrient handle rotates to the best rest orientation"
```

---

### Task 3: TransformSection "Auto-orient" button

**Files:**
- Modify: `src/components/prepare/TransformSection.tsx`
- Test: `src/components/prepare/TransformSection.test.tsx` (extend)

**Interfaces:**
- Consumes: `viewerRef.current.autoOrient()` and its `AutoOrientOutcome`.
- Produces: an "Auto-orient" button in the Drop to floor / Center on plate row, plus a `<p>` result note.

- [ ] **Step 1: Write the failing test** (append to `TransformSection.test.tsx`; read the file first for its render helper - it passes `viewerRef={{ current: { ...mockedMethods } }}` and sets store state in `beforeEach`)

```ts
describe('TransformSection - auto-orient', () => {
  it('calls autoOrient and shows the before/after note', async () => {
    const autoOrient = vi.fn(() => ({ status: 'applied', beforePct: 60, afterPct: 5 }))
    render(<TransformSection viewerRef={{ current: { autoOrient } as never }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Auto-orient' }))
    expect(autoOrient).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Overhang area 60% to 5%')).toBeTruthy()
  })

  it('shows the too-large note when the search was skipped', async () => {
    const autoOrient = vi.fn(() => ({ status: 'skipped' }))
    render(<TransformSection viewerRef={{ current: { autoOrient } as never }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Auto-orient' }))
    expect(screen.getByText('Model too large to auto-orient')).toBeTruthy()
  })

  it('shows the already-oriented note on a no-op', async () => {
    const autoOrient = vi.fn(() => ({ status: 'noop' }))
    render(<TransformSection viewerRef={{ current: { autoOrient } as never }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Auto-orient' }))
    expect(screen.getByText('Already well oriented')).toBeTruthy()
  })

  it('disables the button while locked', () => {
    useViewerStore.setState({ splitParts: [{ id: 'a', name: 'a', triangleCount: 1, visible: true }] })
    render(<TransformSection viewerRef={{ current: null }} />)
    expect((screen.getByRole('button', { name: 'Auto-orient' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
```

Match the file's existing `beforeEach` store setup (it needs `geometryDetails` non-null for `locked` to be false, plus `splitParts: []`, `measureMode: false`). If the file's `beforeEach` already sets those, your new `describe` inherits nothing - add its own `beforeEach` mirroring the file's.

- [ ] **Step 2:** run red.

- [ ] **Step 3: Implement.** In `TransformSection.tsx`:

- Add local state near the other `useState` calls: `const [orientNote, setOrientNote] = useState<string | null>(null)`.
- Add the handler near `applyMove` / `applyRotate`:

```ts
  const runAutoOrient = () => {
    const r = viewerRef.current?.autoOrient()
    if (!r || r.status === 'empty') return
    if (r.status === 'skipped') { setOrientNote('Model too large to auto-orient'); return }
    if (r.status === 'noop') { setOrientNote('Already well oriented'); return }
    setOrientNote(`Overhang area ${r.beforePct}% to ${r.afterPct}%`)
  }
```

- In the final `<div className="flex gap-2">` that holds "Drop to floor" and "Center on plate", add a third button:

```tsx
          <button
            type="button"
            disabled={locked}
            onClick={runAutoOrient}
            className="px-3 py-1.5 rounded bg-[var(--bg-button)] text-sm disabled:opacity-50"
          >
            Auto-orient
          </button>
```

- Immediately AFTER that `<div className="flex gap-2">` closes and before the outer container closes, add:

```tsx
        {orientNote && <p className="text-xs text-[var(--text-muted)]">{orientNote}</p>}
```

- [ ] **Step 4:** run green, full suite.

- [ ] **Step 5: Commit**

```bash
git add src/components/prepare/TransformSection.tsx src/components/prepare/TransformSection.test.tsx
git commit -m "feat: TransformSection - Auto-orient button and result note"
```

---

### Task 4: HELP_SECTIONS entry

**Files:**
- Modify: `src/components/HelpModal.tsx`
- Test: `src/components/HelpModal.test.tsx` (extend)

- [ ] **Step 1: Write the failing test** - add to the "renders the guide" test: `expect(screen.getByRole('heading', { name: 'Auto-orient' })).toBeTruthy()`.

- [ ] **Step 2:** run red.

- [ ] **Step 3: Implement** - append to `HELP_SECTIONS`, after "Build volume":

```ts
  {
    title: 'Auto-orient',
    body: 'Auto-orient tries many rest orientations and picks the one with the least downward-facing overhang area, breaking ties by a lower height and more bed contact. It rotates the model, drops it to the floor, and centres it on the plate as one undoable step, then reports the overhang-area change. Very large models are skipped for speed.',
  },
```

- [ ] **Step 4:** run green, full suite.

- [ ] **Step 5: Commit**

```bash
git add src/components/HelpModal.tsx src/components/HelpModal.test.tsx
git commit -m "docs: HelpModal - Auto-orient feature-guide entry"
```

---

### Task 5: e2e spec (hard completion gate)

**Files:**
- Create: `e2e/auto-orient.spec.ts`

Mirror `e2e/build-volume-box.spec.ts` (read it): inline STL + `DragEvent('drop')`, `.filter({ visible: true })` on every locator, `test.skip(isMobile, ...)`, `test.setTimeout(120_000)`. Also read `e2e/transform-panel.spec.ts` (or whichever transform e2e exists) for how it opens the Transform section and triggers Undo.

**Fixture:** a closed thin slab tilted ~35 degrees about X. Its large
underside is a support-needing overhang (tilted, not resting on the plate),
so auto-orient rotates it flat.

**What to assert.** The Overhangs readiness row is floor-inclusive: a closed
solid resting on any face always has a straight-down face, so the row never
reaches `pass` and the e2e must NOT assert that. Instead: capture the row's
`N overhang face(s)` detail before, run Auto-orient, assert the Transform
note appears with a sane before/after, assert the row is still a valid
`\d+ overhang face` detail with a count that CHANGED (proof the model was
reoriented and re-measured), then Undo and assert the count returns to the
captured value.

- [ ] **Step 1: Write the spec**

```ts
import { expect, test, type Page } from '@playwright/test'

/** A ~35-degree tilted thin slab (two skinned quads + edges), closed, so the
 *  underside is a support-needing overhang at the 45-degree threshold. */
function tiltedSlabStl(): string {
  const deg = 35
  const t = (deg * Math.PI) / 180
  const dy = Math.sin(t) * 12
  const dz = Math.cos(t) * 12
  const th = 1.5 // slab thickness along +Y
  // top face corners
  const A = [0, 0, 0], B = [12, 0, 0], C = [12, dy, dz], D = [0, dy, dz]
  // bottom face corners (lifted by th on Y)
  const a = [0, th, 0], b = [12, th, 0], c = [12, dy + th, dz], d = [0, dy + th, dz]
  const tris: number[][][] = [
    [A, B, C], [A, C, D],       // top
    [a, c, b], [a, d, c],       // bottom
    [A, a, b], [A, b, B],       // near edge
    [D, c, d], [D, C, c],       // far edge
    [A, D, d], [A, d, a],       // left edge
    [B, b, c], [B, c, C],       // right edge
  ]
  let out = 'solid slab\n'
  for (const [p, q, r] of tris) {
    out += 'facet normal 0 0 0\nouter loop\n'
    for (const v of [p, q, r]) out += `vertex ${v[0]} ${v[1]} ${v[2]}\n`
    out += 'endloop\nendfacet\n'
  }
  return out + 'endsolid slab\n'
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

const OVERHANG_COUNT = /(\d+) overhang face/

test.describe('Auto-orient', () => {
  test('reorients a tilted slab, updates the overhang row, and undoes', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Auto-orient flow verified on desktop')
    test.setTimeout(120_000)

    await dropStl(page, tiltedSlabStl(), 'slab.stl')
    await page.getByRole('button', { name: 'Prepare' }).filter({ visible: true }).click()

    const check = (id: string) => page.getByTestId(`check-${id}`).filter({ visible: true })
    await expect(check('overhangs')).toBeVisible()
    const beforeText = (await check('overhangs').textContent()) ?? ''
    const beforeCount = Number(beforeText.match(OVERHANG_COUNT)?.[1])
    expect(Number.isFinite(beforeCount)).toBe(true)

    await page.getByRole('button', { name: 'Auto-orient' }).filter({ visible: true }).click()

    const note = page.getByText(/Overhang area \d+% to \d+%/).filter({ visible: true })
    await expect(note).toBeVisible()
    const m = ((await note.textContent()) ?? '').match(/Overhang area (\d+)% to (\d+)%/)
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(Number(m?.[2])) // never rotates to a worse orientation

    await expect(check('overhangs')).toContainText(OVERHANG_COUNT)
    const afterCount = Number(((await check('overhangs').textContent()) ?? '').match(OVERHANG_COUNT)?.[1])
    expect(afterCount).not.toBe(beforeCount) // the model was reoriented and re-measured

    // Undo (adjust to the real control - see e2e/transform-panel.spec.ts) restores the count.
    await page.getByRole('button', { name: 'Undo', exact: true }).filter({ visible: true }).click()
    await expect(check('overhangs')).toContainText(`${beforeCount} overhang face`)
  })
})
```

- [ ] **Step 2: Run it.** `npx playwright test e2e/auto-orient.spec.ts`. Adjust selectors to the real DOM: the Undo control (find it in an existing transform/repair e2e), the readiness-row testid shape (from `e2e/overhang-heatmap.spec.ts` / `ReadinessCard.tsx`), and the exact "overhangs" row detail wording (it may be "N overhang faces" plural, or singular at 1; the regex `/(\d+) overhang face/` matches both). If Auto-orient returns `noop` on this fixture (the note would then read "Already well oriented"), the slab is not clearly sub-optimal enough: increase the tilt toward 40 degrees or make it thinner so the tilted underside dominates the surface area. Run twice for stability. No retries, no arbitrary waits. If Auto-orient returns `applied` but `afterCount === beforeCount` every run (the reorientation does not change the floor-inclusive count at all), pick a fixture with a genuine asymmetric overhang (a stepped block: a base box with a smaller box overhanging one edge) so the count provably moves; report what you changed. STOP and report BLOCKED only if Auto-orient throws or returns an outcome the note logic cannot render.

- [ ] **Step 3: Commit**

```bash
git add e2e/auto-orient.spec.ts
git commit -m "test: e2e auto-orient reorients a tilted slab, moves the overhang count, and undoes"
```

---

### Task 6: docs

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-08-30-print-prep-roadmap.md`

- [ ] **Step 1: README** - add a short "Auto-orient" mention by the Transform feature bullets, matching the file's style. No em dash.

- [ ] **Step 2: CHANGELOG** - under the current unreleased / next-version heading, matching the SP-5a entry format:

```
- Prepare panel: auto-orient (SP-5b). One button searches rest
  orientations and rotates the model to the one with the least
  downward-facing overhang area, then drops it to the floor and centres
  it on the plate as a single undoable step. Large models are skipped.
```

- [ ] **Step 3: roadmap** - in the "SP-5 decomposition" table, change the SP-5b row to SHIPPED: branch `worktree-sp5b-auto-orient`, commit range (from `git log`), files (`src/services/autoOrient.ts`, `src/components/Viewer3D.tsx` `autoOrient` handle, `src/components/prepare/TransformSection.tsx` button + note, `src/components/HelpModal.tsx` entry, `e2e/auto-orient.spec.ts`), spec/plan links. Note SP-5c (bed layout) is the last remaining SP-5 cycle.

- [ ] **Step 4: Sanity** - `pnpm exec tsc --noEmit && pnpm test`.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md docs/superpowers/specs/2026-08-30-print-prep-roadmap.md
git commit -m "docs: record SP-5b auto-orient"
```

---

## Self-Review

**1. Spec coverage:**

| Spec item | Task |
|-----------|------|
| `autoOrient.ts`: `fibonacciSphere`, `computeBestOrientation`, constants, cost weights, size gate, tie rule | 1 |
| Viewer3D `autoOrient()` handle: merge world geometry, apply quaternion + drop + centre, one undo entry, `AutoOrientOutcome` | 2 |
| TransformSection button + result note (`applied` / `skipped` / `noop`) | 3 |
| `HELP_SECTIONS` entry | 4 |
| e2e hard gate: note appears, overhang-row count moves, undo restores it | 5 |
| README / CHANGELOG / roadmap, SP-5c noted | 6 |

Non-goals (support volume, stability, per-part orient, weight UI, gizmo, animation, store field, prepChecks change) have no task, as intended.

**2. Placeholder scan:** No "TBD". Task 1 gives the full service + full test; Task 2 gives the full handle; Task 3 gives the full JSX and handler; Task 5 gives the full fixture + spec with an explicit "adjust the Undo trigger" note.

**3. Type consistency:** `AutoOrientResult` (service, Task 1) vs `AutoOrientOutcome` (handle, Task 2) are distinct types with distinct fields - service returns fractions + quaternion, handle returns a `status` discriminated union with rounded percentages. `computeBestOrientation(positions: Float32Array, thresholdDeg: number)` signature matches between Task 1 (definition) and Task 2 (call). `AUTO_ORIENT_MAX_FACES` / `AUTO_ORIENT_CANDIDATES` referenced only in Task 1. The quaternion is `[x, y, z, w]` everywhere.
