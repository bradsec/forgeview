# SP-5b: Auto-orient

**Status:** design approved (autonomous cycle, decisions recorded as rulings)
**Roadmap:** SP-5 decomposition, second cycle. SP-5a build-volume box shipped;
SP-5c bed layout remains.
**Depends on:** SP-5a (build-volume box, merged). Reuses SP-4a's overhang
face test and SP-3b's Transform handle pattern.

## Goal

One button that searches candidate orientations, scores each on a print
cost (downward-facing overhang area, part height, bed contact), rotates the
model to the best one, drops it to the floor and centres it on the plate,
and reports the overhang-area change. Everything is one undoable step.

## Non-goals (no task, deliberate)

- Support-volume estimation (needs ray marching per candidate).
- Centre-of-mass / tip-over stability scoring (needs a solid volume model).
- Independent orientation per split part or per model in a multi-model
  scene. Auto-orient rotates all model roots together.
- User-tunable cost weights, a candidate-count slider, or an orientation
  gizmo. Weights and candidate count are fixed constants.
- An animated tumble preview.
- A readiness-row or `GeometryDetails` field. The existing Overhangs and On
  build plate rows already report the state after the rotation.
- Trying to keep the box or heatmap overlays live during the rotation. Auto
  orient goes through the same `refreshSceneEnvironment` + rebuild path the
  other Transform actions use.

## Architecture

### Orientation search (`src/services/autoOrient.ts`) - new file

Pure math plus a `THREE.Quaternion` for the final result. No new dependency.

```ts
import * as THREE from 'three'

export const AUTO_ORIENT_CANDIDATES = 128
export const AUTO_ORIENT_MAX_FACES = 200_000

export interface AutoOrientResult {
  /** Rotation to apply to the model, [x, y, z, w]. Identity when the model
   *  is already at the best candidate or when the search was skipped. */
  quaternion: [number, number, number, number]
  /** Downward-facing overhang area as a fraction of total surface area,
   *  for the current orientation and for the chosen one. */
  overhangFractionBefore: number
  overhangFractionAfter: number
  candidatesEvaluated: number
  /** true when faceCount exceeded AUTO_ORIENT_MAX_FACES; nothing was searched. */
  skipped: boolean
}

/** n roughly-uniform unit vectors on the sphere (Fibonacci lattice). */
export function fibonacciSphere(n: number): [number, number, number][]

/**
 * `positions` is a WORLD-SPACE, NON-INDEXED triangle soup (9 floats/face) -
 * the merged current geometry of every model mesh. `thresholdDeg` is the
 * overhang angle from straight down (same value the Overhangs row uses).
 */
export function computeBestOrientation(
  positions: Float32Array,
  thresholdDeg: number,
): AutoOrientResult
```

**`computeBestOrientation` algorithm:**

1. `faceCount = positions.length / 9`. If `faceCount > AUTO_ORIENT_MAX_FACES`
   return `{ quaternion: [0,0,0,1], overhangFractionBefore: f0,
   overhangFractionAfter: f0, candidatesEvaluated: 0, skipped: true }` where
   `f0` is the current-orientation overhang fraction from a single pass (so
   the caller can still show a number). Actually to keep it O(faces) even
   when skipped, compute `f0` in that one pass.
2. Precompute per face once: unit normal `(nx,ny,nz)`, area `len/2`
   (`len` = cross-product magnitude; skip faces with `len < 1e-10`), and
   the face centroid is not needed. Store `normals` (Float32Array 3/face),
   `areas` (Float32Array 1/face), and the raw vertex positions stay in
   `positions`. `totalArea = sum(areas)`.
3. Candidate down-directions: `[[0,-1,0], ...fibonacciSphere(AUTO_ORIENT_CANDIDATES)]`.
   The first entry is the current orientation, so its cost is the baseline.
4. For each candidate down-vector `d` (unit):
   - `cosThreshold = Math.cos(thresholdDeg * Math.PI / 180)`.
   - First a vertex pass for the height extent: `minH` / `maxH` over every
     vertex as `dot(vertex, d_up)` where `d_up = -d`. `height = maxH - minH`;
     `contactEps = max(height * 1e-3, 1e-4)`.
   - Then a face loop:
     - `nd = nx*d.x + ny*d.y + nz*d.z`.
     - Bed contact: a face is resting on the plate for this candidate when
       `nd > 0.985` (facing almost straight down) AND all 3 vertices are
       within `contactEps` of `minH` along `d_up`. Add its area to
       `contactArea`.
     - Support-needing overhang: a face counts when `nd > cosThreshold`
       (normal within `thresholdDeg` of `d`) AND it is NOT a bed-contact
       face. Add its area to `overhangArea`. A face resting flat on the
       plate points straight down but needs no support, so excluding the
       contact set is what makes "rest it flat" the low-overhang answer
       instead of "stand it on edge". This is deliberately a different
       measure from the floor-inclusive count the Overhangs readiness row
       shows; the number reported to the user is "overhang area needing
       support".
   - `overhangFraction = totalArea > 0 ? overhangArea / totalArea : 0`.
   - `contactFraction = totalArea > 0 ? contactArea / totalArea : 0`.
   - `heightNorm = boundingDiag > 0 ? height / boundingDiag : 0` where
     `boundingDiag` is the length of the position buffer's axis-aligned
     bounding box diagonal (orientation-independent, computed once).
   - `cost = 1.0 * overhangFraction + 0.2 * heightNorm - 0.15 * contactFraction`.
5. Winner = the candidate with the lowest cost. Ties (within `1e-9`) keep
   the earlier candidate, so the current orientation wins a tie and the
   result is a no-op.
6. If the winner is candidate 0, `quaternion = [0,0,0,1]`. Otherwise
   `quaternion` = `new THREE.Quaternion().setFromUnitVectors(dWinner, new
   THREE.Vector3(0,-1,0)).toArray()` - the rotation that brings the winning
   down-direction to straight down.
7. `overhangFractionBefore` = candidate 0's fraction; `overhangFractionAfter`
   = the winner's; `candidatesEvaluated = AUTO_ORIENT_CANDIDATES + 1`.

Cost weights (`1.0`, `0.2`, `0.15`) and `AUTO_ORIENT_CANDIDATES` are module
constants, not parameters.

### Viewer3D (`src/components/Viewer3D.tsx`)

New handle method on `Viewer3DHandle`:

```ts
autoOrient: () => AutoOrientOutcome
```

```ts
export type AutoOrientOutcome =
  | { status: 'applied'; beforePct: number; afterPct: number }
  | { status: 'noop' }        // already at the best orientation
  | { status: 'skipped' }     // model too large
  | { status: 'empty' }       // no model
```

Implementation, mirroring `rotateModelBy` + `dropToFloor` + `centerOnPlate`:

```ts
autoOrient: () => {
  const roots = modelRoots()
  if (roots.length === 0) return { status: 'empty' }

  // Merge every model mesh's current geometry, world-baked and non-indexed,
  // into one triangle soup (same recipe updateGeometryDetails uses per mesh).
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
  const positions = new Float32Array(total)
  let off = 0
  for (const c of chunks) { positions.set(c, off); off += c.length }

  const threshold = useViewerStore.getState().overhangThresholdDeg
  const res = computeBestOrientation(positions, threshold)

  if (res.skipped) return { status: 'skipped' }

  const q = new THREE.Quaternion(res.quaternion[0], res.quaternion[1], res.quaternion[2], res.quaternion[3])
  const isIdentity = q.x === 0 && q.y === 0 && q.z === 0 && Math.abs(q.w) === 1
  if (isIdentity) return { status: 'noop' }

  const prevQuat = roots.map((r) => r.quaternion.clone())
  const prevPos = roots.map((r) => r.position.clone())

  // Rotate about world origin (matches rotateModelBy), then drop to floor and
  // centre on the plate so a large reorientation does not fling the model.
  roots.forEach((r) => r.quaternion.premultiply(q))
  const boxA = new THREE.Box3()
  for (const r of roots) boxA.expandByObject(r)
  const dy = -boxA.min.y
  const cA = boxA.getCenter(new THREE.Vector3())
  roots.forEach((r) => { r.position.y += dy; r.position.x += -cA.x; r.position.z += -cA.z })

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
    status: 'applied',
    beforePct: Math.round(res.overhangFractionBefore * 100),
    afterPct: Math.round(res.overhangFractionAfter * 100),
  }
},
```

Note: `boxA` is computed AFTER the quaternion premultiply, so `expandByObject`
sees the rotated roots. `expandByObject` calls `updateWorldMatrix`
internally in three 0.185, so the box is current.

No interlock, no size-gated store field. If a heatmap or the build-volume
box is armed, `refreshSceneEnvironment` and the existing overlay effects
(keyed on `rendererGen` / mode flags / dimensions) rebuild them against the
new orientation on the next commit, the same as any other Transform action.

### TransformSection (`src/components/prepare/TransformSection.tsx`)

An "Auto-orient" button plus a result note, in the row with "Drop to floor"
and "Center on plate" (the other compute-and-apply one-shots):

```tsx
const [orientNote, setOrientNote] = useState<string | null>(null)

const runAutoOrient = () => {
  const r = viewerRef.current?.autoOrient()
  if (!r || r.status === 'empty') return
  if (r.status === 'skipped') { setOrientNote('Model too large to auto-orient'); return }
  if (r.status === 'noop') { setOrientNote('Already well oriented'); return }
  setOrientNote(`Overhang area ${r.beforePct}% to ${r.afterPct}%`)
}
```

Button: `disabled={locked}`, label `Auto-orient`, `onClick={runAutoOrient}`.
Below the Drop to floor / Center on plate row, render
`{orientNote && <p className="text-xs text-[var(--text-muted)]">{orientNote}</p>}`.
Clear `orientNote` (set to `null`) at the top of `applyMove` / `applyRotate`
/ `applyScale` and in the Mirror / Drop / Center handlers is NOT required;
leave the note until the next auto-orient. Keep it simple: the note only
updates when Auto-orient runs.

### HelpModal (`src/components/HelpModal.tsx`)

Append to `HELP_SECTIONS`, after "Build volume":

```ts
  {
    title: 'Auto-orient',
    body: 'Auto-orient tries many rest orientations and picks the one with the least downward-facing overhang area, breaking ties by a lower height and more bed contact. It rotates the model, drops it to the floor, and centres it on the plate as one undoable step, then reports the overhang-area change. Very large models are skipped for speed.',
  },
```

### e2e (`e2e/auto-orient.spec.ts`)

Mirror `e2e/build-volume-box.spec.ts` conventions.

**Fixture:** a closed thin slab tilted about 35 degrees from horizontal.
Its large underside is a support-needing overhang (tilted, not resting on
the plate), so auto-orient rotates it flat. The Overhangs readiness row
(floor-inclusive) will NOT reach zero for a closed solid resting on a face,
so the e2e does not assert `pass`; it asserts the Transform note and an
undo round-trip on the row's count.

Scenario:
1. Drop the tilted-slab STL, open Prepare.
2. `check('overhangs')` is present; capture its detail text (`N overhang face(s)`).
3. Click "Auto-orient".
4. The Transform section shows a note matching `/Overhang area \d+% to \d+%/`,
   and parsing it, `before >= after` (the search never rotates to a worse
   orientation).
5. `check('overhangs')` is still present with a `\d+ overhang face` detail
   (the recompute did not crash or go unavailable), and its count differs
   from step 2 (the model was reoriented and re-measured).
6. Undo (read `e2e/transform-panel.spec.ts` for the real Undo control)
   restores the step-2 count exactly.

If the tilted slab happens to score `noop` (the search found nothing
better), tilt it more or thin it so the underside dominates the area and a
flat rest is clearly cheaper. The gate is: Auto-orient runs, returns an
`applied` outcome with a sane before/after, and undo restores the prior
state.

### Docs

- README: an "Auto-orient" mention by the Transform bullets.
- CHANGELOG under the unreleased heading: auto-orient, SP-5b, one undoable
  reorient that minimises overhang area.
- Roadmap SP-5 table: SP-5b row to SHIPPED with branch, commit range, files.
  Note SP-5c (bed layout) remains.

## Global constraints

- No new npm dependency. `THREE.Quaternion.setFromUnitVectors` and
  `Vector3` are built in; the Fibonacci lattice is a few lines.
- No em dash in prose, comments, or commit messages.
- No `@testing-library/jest-dom`; assert with vitest / RTL core.
- Every feature ships in the same cycle: code + unit tests + a passing e2e
  + a `HELP_SECTIONS` entry + README / CHANGELOG / roadmap.

## Rulings

- **R1. Fibonacci-lattice candidate directions, fixed count 128, plus the
  current orientation.** Deterministic, dependency-free, dense enough for a
  rest-orientation search. No convex hull, no gradient descent (local
  minima, non-determinism).
  **SUPERSEDED during implementation (commit 0aa22db).** A 128-point lattice
  is too sparse: it rarely lands within the contact-normal tolerance of a
  real resting face, so a flat rest is mis-scored as full overhang and the
  search prefers a tall zero-overhang orientation. The shipped candidate set
  is the model's own face normals (de-duplicated on a ~1 degree grid,
  largest total coplanar area first, capped at 64) plus a 64-point Fibonacci
  sweep for shapes with no good flat face. Still deterministic and
  dependency-free.
- **R2. Cost = 1.0 * overhangAreaFraction + 0.2 * heightNorm - 0.15 *
  contactAreaFraction.** Overhang area dominates (support material and
  surface finish); height and bed contact are tie-breakers. Weights are
  module constants. Reported number to the user is the overhang-area
  percentage, before and after.
- **R3. One face pass per candidate, no per-candidate vertex-buffer
  rotation.** Per candidate the loop needs only `dot(faceNormal, d)` and
  `dot(vertex, d)`; nothing is re-baked. Precompute normals and areas once.
- **R4. Size gate at `AUTO_ORIENT_MAX_FACES = 200_000`.** Above it the
  search is skipped, the button reports "Model too large to auto-orient",
  and nothing is rotated. Mirrors SP-4b's wall-thickness gate.
- **R5. Auto-orient bundles rotate + drop-to-floor + centre-on-plate into a
  single undo entry labelled "Auto-orient".** A large reorientation about
  the world origin would otherwise fling the model off the plate. Undo
  restores every root's prior quaternion and position.
- **R6. Ties keep the current orientation.** If no candidate beats the
  baseline cost by more than `1e-9`, the result is a no-op (identity
  quaternion, `status: 'noop'`, "Already well oriented"), no undo entry
  pushed.
- **R7. No interlock, no store field, no `prepChecks` / `GeometryDetails`
  change.** Auto-orient is a one-shot Transform action. The Overhangs and
  On build plate rows already report the post-rotation state via the
  existing `updateGeometryDetails` call.
- **R8. Lives in TransformSection**, gated by the same `locked` rule
  (`!details || splitParts.length > 0 || measureMode`) as the other
  Transform actions.
