# SP-4c: X-ray and clipping plane

**Status:** design approved (autonomous cycle, decisions recorded as rulings)
**Roadmap:** SP-4 decomposition, third and final cycle. "Inspect interiors,
verify Make solid / hollow results."
**Depends on:** nothing. Builds on the AnalysisSection + Viewer3D effect
patterns established by SP-4a (overhang) and SP-4b (wall thickness).

## Goal

Two view aids for looking inside a model, so a user can check what Make
solid / hollow / seal actually produced: trapped voids, doubled inner
walls, unclosed cavities.

1. **X-ray** - a toggle that makes every model mesh translucent so interior
   geometry shows through.
2. **Clip plane** - an axis-aligned plane that hides everything on one side,
   exposing a live cross-section. Axis (X/Y/Z), position along that axis,
   and which side is kept are all adjustable.

Both are non-destructive display state. Neither changes geometry, neither
adds scene objects, neither writes to exported files.

## Non-goals (no task, deliberate)

- Capped / filled cross-section (a solid face where the plane cuts). Needs
  stencil passes or CSG; out of scope. The clip is an open section.
- A draggable plane gizmo in the 3D view. Position is a slider only.
- Per-part or per-shell clipping. The plane applies to the whole model.
- Persisting X-ray / clip state per file or across reloads. `setFile`
  resets the two mode flags; axis / offset / flip are kept as sticky user
  preferences (same choice as `minWallThicknessMm` in SP-4b).
- An X-ray edge-highlight / Fresnel shader. Plain `transparent` + lowered
  `opacity` is enough to see through.
- Stripping X-ray opacity from exported mesh formats. STL (the primary
  format) carries no material; OBJ / 3MF / glTF read geometry only through
  `collectExportMeshes`, so the exported file is unaffected regardless.

## Architecture

### Store (`src/store/viewerStore.ts`)

New fields next to the `overhang*` / `wallThickness*` block:

| field | type | default |
|-------|------|---------|
| `xrayMode` | `boolean` | `false` |
| `clipMode` | `boolean` | `false` |
| `clipAxis` | `'x' \| 'y' \| 'z'` | `'y'` |
| `clipOffset` | `number` (0..1, normalised position across the model bbox on the axis) | `0.5` |
| `clipFlip` | `boolean` (which half is kept) | `false` |

Setters: `setXrayMode`, `setClipMode`, `setClipAxis`, `setClipOffset`,
`setClipFlip`.

`setFile` and `setFileFromBuffer` both add `xrayMode: false, clipMode:
false` to their reset object. They do NOT reset `clipAxis` / `clipOffset` /
`clipFlip`.

No `GeometryDetails` change. No `prepChecks` row: X-ray and clip produce no
readiness signal, they are inspection aids.

### Viewer3D (`src/components/Viewer3D.tsx`)

**Renderer.** Set `renderer.localClippingEnabled = true` at both renderer
creation sites (the initial mount effect near line 1033, and the
settings-driven `newRenderer` near line 1555), right after `setSize`. It is
inert until a material carries a non-empty `clippingPlanes` array.

**X-ray helpers.**

```ts
const xrayRef = useRef<{ mat: THREE.Material; transparent: boolean; opacity: number; depthWrite: boolean }[] | null>(null)

const applyXray = () => {
  teardownXray()
  const seen = new Set<THREE.Material>()
  const saved: { mat: THREE.Material; transparent: boolean; opacity: number; depthWrite: boolean }[] = []
  for (const mesh of withGeometry(modelMeshes())) {
    for (const mat of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
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

Dedupe by material (loaders can share one material across meshes).
`applyXray` calls `teardownXray` first so a mesh-set change between arms
never leaves a stale restore list.

**Clip helpers.**

```ts
const clipPlaneRef = useRef<{ plane: THREE.Plane; mats: THREE.Material[] } | null>(null)

const computeClipPlane = (): THREE.Plane | null => {
  const roots = modelRoots()
  if (roots.length === 0) return null
  const box = new THREE.Box3()
  for (const r of roots) { r.updateWorldMatrix(true, true); box.expandByObject(r) }
  if (box.isEmpty()) return null
  const axis = useViewerStore.getState().clipAxis
  const t = useViewerStore.getState().clipOffset
  const flip = useViewerStore.getState().clipFlip
  const n = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0)
  const min = box.min[axis], max = box.max[axis]
  const cut = THREE.MathUtils.lerp(min, max, t)
  // Plane keeps the half-space where n . p + constant >= 0. With n = +axis
  // and constant = -cut, that keeps p[axis] >= cut. flip negates both.
  if (flip) n.negate()
  const plane = new THREE.Plane(n, flip ? cut : -cut)
  return plane
}

const applyClip = () => {
  const plane = computeClipPlane()
  if (!plane) { teardownClip(); return }
  const cur = clipPlaneRef.current
  if (cur) {
    cur.plane.copy(plane)          // reuse: no reassignment, just move it
  } else {
    const mats: THREE.Material[] = []
    const seen = new Set<THREE.Material>()
    for (const mesh of withGeometry(modelMeshes())) {
      for (const mat of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
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

**Effects** (added after the SP-4b wall-thickness effects):

- `[xrayMode, rendererGen]`: `if (!xrayMode) return; applyXray(); return () => teardownXray()`.
- `[clipMode, rendererGen]`: `if (!clipMode) return; applyClip(); return () => teardownClip()`.
- `[clipAxis, clipOffset, clipFlip]`: `if (clipMode) applyClip()` - recompute
  the plane in place (the `cur.plane.copy` branch), no mesh-set walk, no
  rebuild.
- **Interlock.** X-ray and clip may be on together (translucent shell plus a
  cut is useful), but both are mutually exclusive with the geometry-swapping
  modes (overhang heatmap, wall-thickness heatmap, hole-fill), because those
  hide the originals and freeze recoloured copies - a clip plane assigned to
  a hidden original does nothing, and X-ray on a hidden original is
  invisible.
  - New `[xrayMode]` effect: `if (xrayMode) { setOverhangMode(false); setWallThicknessMode(false); setHoleFillMode(false) }`.
  - New `[clipMode]` effect: same three disarms.
  - Add `setXrayMode(false); setClipMode(false)` inside the existing
    `[overhangMode]`, `[wallThicknessMode]`, and `[holeFillMode]` arm
    effects (additive, their current bodies stay).
  - Every interlock effect keys on exactly one flag and only ever disarms,
    so the set converges in one pass with no combined-dependency array and
    no re-arm loop. This mirrors the SP-4b three-way interlock and its C1
    fix reasoning.
- **Repair auto-disarm.** `[repairDialogOpen, xrayMode, clipMode]`: when the
  Repair dialog opens, disarm both. Repair swaps geometry and materials, so
  the restore lists and the clipped material list would go stale.

`updateGeometryDetails` is untouched. `exporters.ts` is untouched
(no overlay group tag to exclude; `collectExportMeshes` reads geometry).

### AnalysisSection (`src/components/prepare/AnalysisSection.tsx`)

Below the wall-thickness block, an "Inspect" group:

- Section stays under the single `<h3>Analysis</h3>`. Update the intro `<p>`
  to: `Highlight downward-facing overhangs and thin walls, or look inside
  with X-ray and a clip plane.`
- **X-ray toggle**: `<button aria-pressed={xrayMode} disabled={!hasModel}>`
  text `xrayMode ? 'Hide X-ray' : 'Show X-ray'`, `onClick` calls
  `setXrayMode(!xrayMode)`. Mirrors the overhang toggle markup.
- **Clip toggle**: `<button aria-pressed={clipMode} disabled={!hasModel}>`
  text `clipMode ? 'Hide clip plane' : 'Show clip plane'`.
- When `clipMode`, three controls appear (all `disabled={!hasModel}`):
  - **Axis**: three buttons "X" / "Y" / "Z", the active one `aria-pressed`,
    each `onClick` sets `setClipAxis`. Visible label `<span>Clip axis</span>`.
  - **Position**: `<input type="range" aria-label="Clip position" min={0}
    max={1} step={0.01} value={clipOffset} onChange={commit}>`. Commit
    parses the value and calls `setClipOffset(n)` when
    `Number.isFinite(n)` (a range input is always finite and in bounds).
  - **Flip**: `<button aria-pressed={clipFlip}>` text `Flip side`,
    `onClick` sets `setClipFlip(!clipFlip)`.
- No status notes (X-ray / clip skip no meshes and report nothing).

### HelpModal (`src/components/HelpModal.tsx`)

Append to `HELP_SECTIONS`, after "Wall thickness heatmap":

```ts
  {
    title: 'X-ray and clip plane',
    body: 'X-ray makes the model translucent so you can see interior walls and trapped voids. The clip plane hides everything on one side of an adjustable X, Y, or Z cut, showing a live cross-section. Use both to check what Make solid or hollow produced. They turn off automatically when a heatmap or hole-fill is armed.',
  },
```

### e2e (`e2e/xray-clipping.spec.ts`)

Mirror `e2e/wall-thickness-heatmap.spec.ts` conventions: inline STL +
`DragEvent('drop')`, `.filter({ visible: true })` on every locator,
`test.skip(isMobile, ...)`, `test.setTimeout(120_000)`. A simple cube STL
is enough (no thin-wall fixture needed).

Scenario:
1. Drop a cube, open Prepare.
2. Click "Show X-ray" -> "Hide X-ray" button visible.
3. Click "Show clip plane" -> "Hide clip plane" visible, and the "Clip
   position" range plus the X/Y/Z axis buttons appear.
4. Move the range (`fill('0.25')`), click axis "X", click "Flip side" - no
   throw, controls stay visible (a client-side scene assertion is not
   available; the value round-trip through the control is the check).
5. Arm the overhang heatmap ("Show overhang heatmap") -> both "Show X-ray"
   and "Show clip plane" are back (interlock disarmed them).
6. Re-arm X-ray, export via the File menu -> download `cube.stl` (proves
   X-ray does not corrupt the export path).

### Docs (`README.md`, `CHANGELOG.md`, roadmap)

- README: an "X-ray and clip plane" bullet by the heatmap bullets.
- CHANGELOG under the unreleased heading: X-ray + clip plane, SP-4c,
  mutually exclusive with the heatmaps.
- Roadmap SP-4 table: SP-4c row -> SHIPPED with branch, commit range, files.
  Note SP-4 (analysis heatmaps) is then complete.

## Global constraints

- No new npm dependency. `THREE.Plane` and `renderer.localClippingEnabled`
  are built in.
- No em dash in prose, comments, or commit messages.
- No `@testing-library/jest-dom`; assert with vitest / RTL core.
- Every feature ships in the same cycle: code + unit tests + a passing e2e
  + a `HELP_SECTIONS` entry + README / CHANGELOG / roadmap. (feature-ship
  checklist.)

## Rulings

- **R1. Ship X-ray and clip in one cycle.** Both are small, share the
  "inspect interior" purpose, and both are pure display state. Splitting
  them would double the ceremony for no isolation benefit.
- **R2. X-ray and clip are compatible with each other, mutually exclusive
  with overhang / wall-thickness / hole-fill.** The heatmaps and hole-fill
  hide originals; a clip or X-ray on a hidden mesh is a no-op. Keeping the
  interlock single-flag and disarm-only (never a combined dep) is the
  lesson from SP-4b's C1.
- **R3. Mutate materials in place, restore from a saved list, dedupe by
  material.** No material cloning (matches `applyViewMode`, which also
  mutates in place). `apply*` calls `teardown*` first so a mesh-set change
  never strands a stale list.
- **R4. Clip position is a normalised 0..1 offset across the live model
  bbox**, not a world coordinate. Survives transform / scale without the
  slider range going out of date.
- **R5. Reuse one `THREE.Plane`; axis / offset / flip changes `copy` into
  it** rather than reassigning `material.clippingPlanes`, so a slider drag
  is a plane move, not a material-array churn + shader recompile.
- **R6. No prepChecks / GeometryDetails / exporters change.** X-ray and
  clip yield no readiness signal and add no scene objects. Exporters read
  geometry only, so an armed X-ray or clip cannot reach the output file.
- **R7. Repair dialog disarms both.** Repair swaps geometry and materials;
  the saved restore list and the clipped-material list would dangle.
