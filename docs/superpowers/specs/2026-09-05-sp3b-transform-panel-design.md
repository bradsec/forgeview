# SP-3b: Transform panel

Status: approved design, 2026-09-05. Part of the print-prep roadmap
(`2026-08-30-print-prep-roadmap.md`). Second and final cycle of SP-3
(units + measure + transform). Builds on SP-3a (units, mm dimensions, the
`scaleModelBy` root-transform pattern, the SP-2a undo stack) and SP-1
(Prepare panel).

## Purpose

Give the Prepare panel the remaining "prep a model before slicing" moves
catalogue item 8 lists: move, rotate, free (per-axis) scale, mirror,
drop-to-floor, and center-on-plate. SP-3a already shipped uniform
scale-to-target / scale-to-fit-build-volume; SP-3b covers everything else
that repositions or reshapes a model as a rigid/affine transform.

## Current state (relevant slice, established in SP-3a)

- `Viewer3D.tsx` `modelRoots()` / `updateGeometryDetails()` /
  `refreshSceneEnvironment()` / `pushUndo()` / `invalidate()` are the shared
  machinery every edit op already uses. `scaleModelBy(factor, label)`
  multiplies every model root's `.scale` and pushes one bespoke `UndoEntry`
  (`apply` restores captured pre-op vectors + re-runs the three refreshers,
  `discard` a no-op) — SP-3b's five new ops follow this exact shape.
  `getModelDimensionsMm()` and `modelUnitInMm` (mm per one raw geometry unit,
  independent of the object's own `.scale`) are already on the handle.
- `collectExportMeshes` (`src/services/exporters.ts`) bakes each mesh's
  `matrixWorld` (position + rotation + scale) and reverses triangle winding
  when the baked matrix's determinant is negative. Every SP-3b op (move,
  rotate, non-uniform scale, mirror) is therefore exported correctly with
  **no exporter changes needed** — mirror's negative-determinant case is
  already handled by the code that made the observation above.
- Scene up-axis is world Y: the grid sits at `box.min.y`
  (`Viewer3D.tsx`, `refreshSceneEnvironment`), and `GeometryDetails.height`
  is `size.y`. `buildVolumeMm.y` (SP-3a) is compared against that same
  `height`. So "floor" is world `Y = 0`; "plate" is the world X/Z plane.
- `ScaleSection.tsx` (SP-3a) is the direct UI precedent: locked (all
  controls disabled + a reason) when `!geometryDetails || splitParts.length
  > 0 || measureMode`, local string state for numeric inputs (so a field can
  be cleared mid-edit), Apply buttons gated on `Number.isFinite`.
- Only `.stl` / `.ply` loaders set `side: THREE.DoubleSide` on their
  material (`src/loaders/index.ts:159,165`). `.obj` / `.3mf` / `.gltf` /
  `.glb` / `.dae` use loader-supplied materials that may be single-sided.

## Decisions (locked 2026-09-05)

### Scope: one cycle, not split like SP-2/SP-3a

SP-3b's five ops (move, rotate, free scale, mirror, drop-to-floor,
center-on-plate — six actually, catalogue lists "scale" once but SP-3a
already covers the "to an exact length" case) share one root-transform
mechanism and one UI section. Unlike SP-2's four independently-shippable
repair stages, there is no natural sub-boundary here worth a separate
spec/plan/release per op. One spec, one plan, one release.

### Interaction model: every numeric action is a delta, not an absolute target

Move offsets, rotation angles, and free-scale factors are all **applied on
top of the current transform and the input resets afterward** — a nudge
control, not a "set to" field. This matches `scaleModelBy`'s existing
delta semantics (multiply current scale by `factor`) and keeps one mental
model across every action in the section: type a number, click Apply, the
model moves/rotates/stretches that much, the field clears back to blank/0
for the next nudge.

- **Move**: three inputs (X/Y/Z) in the current `measurementUnit`
  (mm/cm/in). Converted to a raw-geometry-unit delta via
  `deltaRaw = toMm(value, unit) / (modelUnitInMm ?? 1)` (translation lives
  in the parent/world frame, so it is independent of the object's own
  `.scale` — same reasoning `getModelDimensionsMm` already relies on).
  Applied as `root.position.x/y/z += deltaRaw` per axis with a value.
- **Rotate**: three inputs (X/Y/Z) in degrees. Applied as
  `root.rotation.x/y/z += THREE.MathUtils.degToRad(deg)` per axis with a
  value (Three's default Euler order, `'XYZ'`, matches "rotate about each
  world axis in turn" closely enough for a nudge control — no order picker).
- **Free scale**: three inputs (X/Y/Z), each a plain multiplier (default
  blank means "leave that axis alone", NOT `1`, so a user can stretch only
  Y without retyping 1 into X and Z). Applied as
  `root.scale.x/y/z *= factor` per axis with a value that is finite and
  `> 0`. This is a **different affordance from SP-3a's Scale section**
  (target-length / fit-to-volume): SP-3b's free scale is for disproportionate
  stretching, entered as a raw ratio, not a target dimension. Both sections
  write the same `.scale` property; there is no conflict, undo unwinds
  whichever ran last.
- **Mirror**: three buttons, "Mirror X" / "Mirror Y" / "Mirror Z" — no
  numeric input. Negates that one `.scale` component
  (`root.scale.x *= -1`, etc.).
- **Drop to floor**: one button, no input. Translates every root by the
  same world-Y delta so the union bounding box's `min.y` becomes `0`
  (`deltaY = -box.min.y`, applied to every root's `position.y` — computed
  once from the union box, then applied uniformly so multi-model relative
  positions are preserved).
- **Center on plate**: one button, no input. Translates every root so the
  union bounding box's X/Z center becomes `(0, 0)`, `Y` untouched
  (`deltaX = -boxCenter.x`, `deltaZ = -boxCenter.z`, applied uniformly to
  every root exactly like drop-to-floor, so relative multi-model layout is
  preserved and only the whole assembly's footprint re-centers).

### Multi-model support

Move / rotate / free-scale / mirror apply **per root independently** (each
root gets its own delta applied to its own current transform) — this
matches how a user would nudge/rotate/stretch one object at a time in the
single-file preview case, which is the only case with a numeric input UI
today (the Prepare panel already gates its readiness card and other
sections on `geometryDetails`, which is null when nothing is loaded and
populated for both single- and multi-model scenes). Drop-to-floor and
center-on-plate compute ONE delta from the union box and apply that same
world-space delta to every root, so a multi-model scene's relative layout
is preserved while the whole assembly moves onto the plate/floor together.
This mirrors `refreshSceneEnvironment`'s own union-box treatment of
multi-model scenes.

### Undo

Each of the six actions pushes exactly one bespoke `UndoEntry` (matching
`scaleModelBy`'s shape): capture every root's pre-op `position` / `rotation`
/ `scale` (only the fields that action can change — e.g. mirror only needs
`scale`, move only needs `position`), `apply` restores those captured
vectors on every root then re-runs `updateGeometryDetails()` +
`refreshSceneEnvironment()` + `invalidate()`, `discard` is a no-op (no
retained geometry, same as scale). Labels: `"Move"`, `"Rotate"`,
`"Scale (free)"`, `"Mirror X"` / `"Mirror Y"` / `"Mirror Z"`,
`"Drop to floor"`, `"Center on plate"`.

### Guards

`TransformSection` is locked (every control disabled, a reason shown) under
the same three conditions as `ScaleSection`: `!geometryDetails`,
`splitParts.length > 0`, or `measureMode`. Reasons match `ScaleSection`'s
wording ("Recombine split parts before...", "Stop measuring before...",
"Open a model to..."). Numeric-input actions (Move/Rotate/Free scale) are
additionally disabled per-axis-group when every one of that action's three
fields is blank or non-finite (nothing to apply); button actions
(Mirror/Drop to floor/Center on plate) have no input validation, only the
shared lock.

### Known limitation: mirrored preview shading on non-DoubleSide formats

Mirroring negates one scale axis, which flips triangle winding and, for a
single-sided material, can make the mirrored mesh appear to render with
inverted lighting/back-face culling in the live viewport for every format
except `.stl` / `.ply` (the only two loaders that set
`side: THREE.DoubleSide`). The **exported file is always correct**
(`collectExportMeshes` bakes the transform and reverses winding when the
determinant is negative — this already exists, no SP-3b change needed).
Fixing the live-preview shading for other formats (forcing `DoubleSide` on
mirror, or flipping winding live) is out of scope; flagged as a follow-up,
not a defect this cycle introduces.

## Architecture

### New files

| File | Responsibility |
|------|----------------|
| `src/components/prepare/TransformSection.tsx` | Move / Rotate / Free scale inputs + Apply buttons; Mirror X/Y/Z, Drop to floor, Center on plate buttons. Locked like `ScaleSection`. |

### Modified files

| File | Change |
|------|--------|
| `src/components/Viewer3D.tsx` | `Viewer3DHandle`: add `moveModelBy({x,y,z}: {x:number;y:number;z:number})`, `rotateModelBy({x,y,z})` (radians), `scaleModelByAxes({x,y,z})`, `mirrorModel(axis: 'x'\|'y'\|'z')`, `dropToFloor()`, `centerOnPlate()`. Each pushes its own `UndoEntry` per the shape above and re-runs the three refreshers. |
| `src/components/prepare/PreparePanel.tsx` | Mount `<TransformSection viewerRef={viewerRef} />` after `<ScaleSection>`. |

No changes to `src/services/exporters.ts`, `src/store/viewerStore.ts`, or
`src/services/prepChecks.ts` — SP-3b introduces no new persisted state
(every input is transient local component state) and no new readiness
check.

### Data flow

```
TransformSection: Move X/Y/Z inputs (measurementUnit) -> Apply
  -> deltaRaw.<axis> = toMm(value, unit) / (modelUnitInMm ?? 1) for each non-blank axis
  -> viewerRef.moveModelBy(deltaRaw)
       roots.forEach(r => { capture r.position.clone(); r.position.x/y/z += deltaRaw.<axis> })
       pushUndo({ label: 'Move', apply: restore captured positions + refresh, discard: noop })
       updateGeometryDetails(); refreshSceneEnvironment(); invalidate()
  -> inputs reset to blank

TransformSection: Rotate X/Y/Z inputs (degrees) -> Apply
  -> rad.<axis> = degToRad(value) for each non-blank axis
  -> viewerRef.rotateModelBy(rad) -> same capture/apply/undo shape on `.rotation`

TransformSection: Free scale X/Y/Z inputs (multiplier) -> Apply
  -> viewerRef.scaleModelByAxes({x,y,z}) (blank axis treated as factor 1,
     i.e. untouched) -> same shape on `.scale`, guarded per-axis by
     Number.isFinite(factor) && factor > 0

TransformSection: Mirror X/Y/Z button -> viewerRef.mirrorModel(axis)
  -> roots.forEach(r => { capture r.scale.clone(); r.scale[axis] *= -1 })
  -> pushUndo({ label: `Mirror ${axis.toUpperCase()}`, ... })

TransformSection: Drop to floor button -> viewerRef.dropToFloor()
  -> box = union Box3 over roots; deltaY = -box.min.y
  -> roots.forEach(r => { capture r.position.clone(); r.position.y += deltaY })
  -> pushUndo({ label: 'Drop to floor', ... })

TransformSection: Center on plate button -> viewerRef.centerOnPlate()
  -> box = union Box3 over roots; center = box.getCenter(...)
  -> deltaX = -center.x; deltaZ = -center.z
  -> roots.forEach(r => { capture r.position.clone(); r.position.x += deltaX; r.position.z += deltaZ })
  -> pushUndo({ label: 'Center on plate', ... })
```

### Error handling

- No roots (`modelRoots().length === 0`): every handle method is a no-op
  (matches `scaleModelBy`'s existing guard).
- Move/Rotate/Free-scale: a blank field means "don't touch this axis" —
  not `0` for move/rotate (a `0` delta would be a legal no-op entry; blank
  is simply omitted from the delta object) and not `1` for scale (blank
  means factor `1`, i.e. untouched, same outcome as typing `1`). Apply is
  disabled when every field for that action is blank/non-finite (nothing to
  do). A non-finite non-blank value (e.g. `"abc"`) also excludes that axis
  from the delta rather than crashing.
- Free-scale factor `<= 0` or non-finite for a given non-blank axis:
  that axis excluded from the delta (same as a blank field); if this leaves
  every axis excluded, Apply is disabled.
- Mirror/Drop to floor/Center on plate: no invalid input possible, only the
  shared lock applies.

## Testing

Matches SP-3a's setup.

- Unit: no new pure-math services are needed (the deltas are simple
  arithmetic already covered by `unitConversion.ts` for the mm conversion);
  cover `TransformSection`'s blank/invalid-axis exclusion logic in its own
  component test.
- `Viewer3D.tsx` handle methods: **no unit test**, same reasoning as
  SP-3a's `scaleModelBy`/`resetMeasure` — the imperative handle needs refs
  the WebGL renderer effect populates, absent in jsdom
  (`Viewer3D.test.tsx` covers only exported pure helpers + the WebGL-less
  error path). Verification is `tsc --noEmit` clean + no unit-suite
  regression; runtime correctness is the e2e's job.
- Component: `TransformSection.test.tsx` — locked states (split/measure/no
  model), each Apply button calls the right handle method with the right
  computed delta, blank-axis exclusion, Mirror/Drop/Center call their
  handle methods with no args.
- E2e (`e2e/transform-panel.spec.ts`, hard completion gate, style of
  `e2e/units-measure.spec.ts`): load a cube, Move it and confirm the
  Dimensions readout / a picked reference shifts, undo; Rotate it and
  confirm the bounding box changes; free-Scale one axis and confirm only
  that dimension changes; Mirror an axis and confirm the export still
  succeeds (a full visual-correctness assertion isn't practical in
  Playwright — assert the operation completed via the readiness/undo UI,
  per the established pattern); Drop to floor and confirm min-Y reads 0 (no
  direct Y readout exists — assert via the grid/box behavior already
  exposed, or add the minimal necessary assertion hook the plan's tasks
  define); Center on plate and confirm X/Z center at 0. Exact assertions are
  finalized in the implementation plan once the concrete DOM hooks are
  chosen task-by-task.

## Non-goals / carry-forward

- **Absolute-position/rotation entry** (type an exact X/Y/Z target instead
  of a delta): the nudge model is deliberately simpler; revisit only if
  users ask for it.
- **Rotation order picker, per-axis quick-90° buttons**: plain delta degree
  inputs only.
- **Live-preview mirror shading fix for non-STL/PLY formats**: documented
  limitation above, not fixed this cycle.
- **Snap-to-grid / numeric-step nudging (arrow-key increments)**: out of
  scope, type-and-Apply only.
- **Per-part transforms after Split by shell**: the shared lock disables
  Transform entirely while `splitParts.length > 0`, same as Scale.
- This closes SP-3, the "units + measure + transform" sub-project. The next
  roadmap item is SP-4 (analysis heatmaps), which depends on SP-3's mm
  scale.
