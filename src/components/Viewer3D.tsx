import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { loadModel, loadModelFromBuffer, disposeModel, applyViewMode, countTriangles, fitAllModels } from '../loaders'
import { useViewerStore } from '../store/viewerStore'
import {
  type ViewDirection,
  type CameraAnimationState,
  createAnimationState,
  tickCameraAnimation,
  snapToView,
  fitAll,
  resetCamera,
  zoomStep,
} from '../utils/cameraActions'
import { getEffectiveSettings } from '../utils/performancePresets'
import { getTheme } from '../themes'
import { analyzeGeometry, summariseHealth } from '../services/meshHealth'
import { repairGeometriesInWorker, type SolidRepairStats } from '../services/solidRepair'
import { runRepairInWorker, type PerMeshStage } from '../services/meshRepair'
import { STAGE_LABEL, fillLoop, type RepairStageId } from '../services/repairStages'
import { clampUndoSteps, pushBounded, discardAll, popApply, type UndoEntry } from '../services/undoStack'
import {
  buildLoopOverlays, disposeLoopOverlays, pickOverlay, makeOverlayMaterials,
  type OverlayEntry,
} from '../services/holeFillOverlay'
import { splitByShell as splitGeometryByShell } from '../services/splitByShell'
import {
  buildMeasureOverlay, setMeasurePoint, measureDistance, pickSurfacePoint,
  disposeMeasureOverlay, type MeasureOverlay,
} from '../services/measureOverlay'
import { fromMm, formatLength } from '../services/unitConversion'

export interface RepairRunResult {
  label: string
  perMesh: PerMeshStage[][]
  seal?: SolidRepairStats
  /** Meshes left untouched because they carry material groups, uv, or color
   * attributes the simple stages would strip. Seal still collapses them. */
  skippedMeshes: number
}

export interface Viewer3DHandle {
  snapToView: (direction: ViewDirection) => void
  fitAll: () => void
  resetCamera: () => void
  zoomIn: () => void
  zoomOut: () => void
  /** Orbit the main camera by delta angles (radians) — used by ViewCube drag */
  orbitBy: (deltaTheta: number, deltaPhi: number) => void
  getCamera: () => THREE.PerspectiveCamera | THREE.OrthographicCamera | undefined
  getScene: () => THREE.Scene | undefined
  runRepair: (
    stageIds: (RepairStageId | 'seal')[],
    sealOpts: { resolution: number; stripInternalWalls: boolean },
    onProgress: (percent: number, phase: string) => void,
    signal?: AbortSignal,
  ) => Promise<RepairRunResult>
  getModelDimensions: () => THREE.Vector3 | null
  /** Assign `modelUnitInMm` to every root that has none (unitless STL/OBJ/PLY). */
  setModelUnit: (mm: number) => void
  /** Union bounding-box size in millimetres, or null when no model is open. */
  getModelDimensionsMm: () => THREE.Vector3 | null
  /** Uniformly scale every model root by `factor` as one undoable edit. */
  scaleModelBy: (factor: number, label: string) => void
  /** Clear the current measurement without leaving measure mode. */
  resetMeasure: () => void
  /** Translate every model root by `delta` (raw geometry units) as one undoable edit. */
  moveModelBy: (delta: { x: number; y: number; z: number }) => void
  /** Rotate every model root by `deltaRad` (radians, added to current Euler XYZ) as one undoable edit. */
  rotateModelBy: (deltaRad: { x: number; y: number; z: number }) => void
  /** Multiply every model root's `.scale` component-wise by `factors` (each
   *  must be finite and > 0, else treated as 1 / untouched) as one undoable edit. */
  scaleModelByAxes: (factors: { x: number; y: number; z: number }) => void
  /** Negate one `.scale` component on every model root as one undoable edit. */
  mirrorModel: (axis: 'x' | 'y' | 'z') => void
  undoEdit: (steps?: number) => void
  /** Split the single open mesh into one mesh per connected shell. Throws an
   * Error with a user-facing message when not applicable. */
  splitByShell: () => { parts: number; droppedFragments: number }
  getSplitPart: (id: string) => THREE.Mesh | undefined
}

export function disposeViewerResources(
  scene: THREE.Scene,
  preview: THREE.Object3D | undefined,
  models: Iterable<THREE.Object3D>,
  grid: THREE.GridHelper | undefined
): void {
  if (preview) disposeModel(preview, scene)
  for (const model of models) disposeModel(model, scene)
  if (grid) {
    scene.remove(grid)
    grid.dispose()
  }
  if (scene.background instanceof THREE.Texture) scene.background.dispose()
  scene.clear()
}

export function perspectiveCameraFrom(
  camera: THREE.OrthographicCamera,
  width: number,
  height: number
): THREE.PerspectiveCamera {
  const next = new THREE.PerspectiveCamera(75, width / height, camera.near, camera.far)
  next.position.copy(camera.position)
  next.up.copy(camera.up)
  return next
}

interface Viewer3DProps {
  filePath: string | null
  fileExtension: string | null
  viewMode: 'solid' | 'wireframe' | 'points'
}

/** A mesh whose geometry the simple repair stages / hole-fill overlay can
 *  safely rewrite: single draw group, non-array material, no uv/color that a
 *  position-only rebuild would strip. */
export function isRepairable(m: THREE.Mesh): boolean {
  const g = m.geometry as THREE.BufferGeometry
  if (Array.isArray(m.material) || g.groups.length > 1) return false
  return !g.getAttribute('uv') && !g.getAttribute('color')
}

export function modelLoadKey(models: Array<{ id: string; path: string; extension: string }>): string {
  return models.map(({ id, path, extension }) => `${id}\u0000${path}\u0000${extension}`).join('\u0001')
}

export const Viewer3D = forwardRef<Viewer3DHandle, Viewer3DProps>(
  function Viewer3D({ filePath, fileExtension, viewMode }, ref) {
  const mountRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | undefined>(undefined)
  const sceneRef = useRef<THREE.Scene | undefined>(undefined)
  const cameraRef = useRef<THREE.PerspectiveCamera | THREE.OrthographicCamera | undefined>(undefined)
  const controlsRef = useRef<OrbitControls | undefined>(undefined)
  // Single-model preview path
  const modelGroupRef = useRef<THREE.Object3D | undefined>(undefined)
  // Multi-model "add to scene" path — keyed by LoadedModel.id
  const modelMapRef = useRef<Map<string, THREE.Object3D>>(new Map())
  // Split-by-shell: the detached-part group added at scene level, and a map
  // from SplitPart.id to its live mesh for visibility sync + export lookup
  const splitPartsGroupRef = useRef<THREE.Group | undefined>(undefined)
  const splitPartsRef = useRef<Map<string, THREE.Mesh>>(new Map())
  // Track in-flight model loads to prevent duplicate loading from effect re-runs
  const loadingIdsRef = useRef<Set<string>>(new Set())
  // Version counter for the single-model preview effect (Effect 2) so a
  // resolution from a superseded or cleared load can be detected and disposed
  const previewVersionRef = useRef(0)
  const gridRef = useRef<THREE.GridHelper | undefined>(undefined)
  const lightsRef = useRef<THREE.Light[]>([])
  const antialiasRef = useRef(true) // matches initial renderer creation
  // Bumped whenever Effect 7 swaps the renderer/canvas (antialias toggle) so
  // the hole-fill pick effect re-runs and rebinds its listeners to the new
  // canvas instead of the disposed one.
  const [rendererGen, setRendererGen] = useState(0)
  const animIdRef = useRef<number>(0)
  const animRef = useRef<CameraAnimationState>(createAnimationState())
  // Current double-click listener and its element, so renderer swaps
  // (Effect 7) and unmount can detach the live listener
  const dblClickRef = useRef<{ el: HTMLElement; fn: (e: MouseEvent) => void } | null>(null)
  const contextRef = useRef<{ el: HTMLCanvasElement; lost: (e: Event) => void; restored: () => void } | null>(null)
  // Demand rendering: frames left to draw. The loop skips renderer.render when
  // 0 and no camera motion — keeps the GPU idle (software/weak GPUs stay
  // responsive). Bumped by controls changes, resizes, and any store change
  // (model loads, view mode, theme, settings all land in the store). A small
  // budget instead of a boolean absorbs mutations that land mid-frame.
  const framesToRenderRef = useRef(3)
  const undoStackRef = useRef<UndoEntry[]>([])
  const holeOverlayRef = useRef<{
    group: THREE.Group
    entries: OverlayEntry[]
    hovered: number
    materials: ReturnType<typeof makeOverlayMaterials>
    badge: HTMLDivElement
  } | null>(null)
  const measureOverlayRef = useRef<MeasureOverlay | null>(null)
  const measureBadgeRef = useRef<HTMLDivElement | null>(null)
  const invalidate = () => { framesToRenderRef.current = 3 }

  const modelRoots = () => [modelGroupRef.current, ...modelMapRef.current.values(), splitPartsGroupRef.current].filter((root): root is THREE.Object3D => Boolean(root))
  const modelMeshes = () => {
    const meshes: THREE.Mesh[] = []
    for (const root of modelRoots()) root.traverse((child) => { if (child instanceof THREE.Mesh) meshes.push(child) })
    return meshes
  }
  // Placeholder geometries from an earlier solid fill hold no triangles and
  // would crash the soup combination on a second run.
  const withGeometry = (list: THREE.Mesh[]) =>
    list.filter((mesh) => ((mesh.geometry as THREE.BufferGeometry).getAttribute('position')?.count ?? 0) > 0)
  const baseModelName = () => {
    const n = useViewerStore.getState().fileName
    if (!n) return 'model'
    return n.replace(/\.[^./\\]+$/, '')
  }
  // Free the live part meshes + their cloned geometries/materials and detach
  // the part group. Never touches the pre-split original — the undo entry owns
  // that (its `apply` re-adds it, its `discard` disposes it).
  const teardownSplitParts = () => {
    const scene = sceneRef.current
    const group = splitPartsGroupRef.current
    if (group) {
      for (const m of splitPartsRef.current.values()) {
        m.geometry.dispose()
        const mat = m.material as THREE.Material | THREE.Material[]
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
        else mat.dispose()
      }
      if (scene) scene.remove(group)
      group.clear()
      splitPartsGroupRef.current = undefined
    }
    splitPartsRef.current.clear()
  }
  const updateGeometryDetails = () => {
    const roots = modelRoots()
    // Make solid leaves attribute-less placeholder geometries on collapsed
    // meshes; they carry no content and must not drag health to "needs repair".
    const meshes = modelMeshes().filter((mesh) => {
      const position = (mesh.geometry as THREE.BufferGeometry).getAttribute('position')
      return position !== undefined && position.count > 0
    })
    if (roots.length === 0 || meshes.length === 0) {
      useViewerStore.getState().setGeometryDetails(null)
      return
    }
    const box = new THREE.Box3()
    for (const root of roots) box.expandByObject(root)
    const size = box.getSize(new THREE.Vector3())
    const health = summariseHealth(meshes.map((mesh) => analyzeGeometry(mesh.geometry)))
    const unitScales = roots.map((root) => root.userData.modelUnitInMm).filter((value): value is number => typeof value === 'number')
    const modelUnitInMm = unitScales.length === roots.length && unitScales.every((value) => value === unitScales[0])
      ? unitScales[0]
      : null
    useViewerStore.getState().setGeometryDetails({
      width: size.x, height: size.y, depth: size.z, meshes: meshes.length, modelUnitInMm, ...health,
    })
  }
  const refreshSceneEnvironment = () => {
    const roots = modelRoots()
    const scene = sceneRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (roots.length === 0 || !scene || !camera || !controls) return
    fitAllModels(roots, camera, controls)
    const box = new THREE.Box3()
    for (const root of roots) box.expandByObject(root)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    if (gridRef.current) {
      scene.remove(gridRef.current)
      gridRef.current.dispose()
    }
    const settings = getEffectiveSettings(
      useViewerStore.getState().performancePreset,
      useViewerStore.getState().performanceOverrides
    )
    const colors = getTheme(useViewerStore.getState().theme)
    const grid = new THREE.GridHelper(maxDim * 3, settings.gridDivisions, colors.gridPrimary, colors.gridSecondary)
    ;(grid as any)._divisions = settings.gridDivisions
    ;(grid as any)._gridSize = maxDim * 3
    grid.position.set(center.x, box.min.y, center.z)
    scene.add(grid)
    gridRef.current = grid
  }
  const updateTriangleDetails = () => {
    if (modelGroupRef.current) useViewerStore.getState().setTriangleCount(countTriangles(modelGroupRef.current))
    for (const [id, root] of modelMapRef.current) useViewerStore.getState().updateModelTriangles(id, countTriangles(root))
  }
  const syncUndoLabels = () => {
    const labels = undoStackRef.current.map((entry) => entry.label).reverse()
    useViewerStore.getState().setUndoLabels(labels)
    useViewerStore.getState().setCanUndoEdit(labels.length > 0)
  }
  const pushUndo = (entry: UndoEntry) => {
    pushBounded(undoStackRef.current, entry)
    syncUndoLabels()
  }
  const clearUndo = () => {
    discardAll(undoStackRef.current)
    // A dropped undo stack can no longer step a seal back, so the "sealed"
    // banner on watertight/manifold rows must not outlive it (it also leaks
    // across models in multi-model mode, where clearUndo runs without setFile).
    useViewerStore.getState().setSealApplied(false)
    syncUndoLabels()
  }

  const applySeal = async (
    resolution: number,
    onProgress: (p: number, phase: string) => void,
    signal: AbortSignal | undefined,
    opts: { stripInternalWalls: boolean },
  ) => {
    const meshes = withGeometry(modelMeshes())
    const result = await repairGeometriesInWorker(meshes, resolution, onProgress, signal, {
      stripInternalWalls: opts.stripInternalWalls,
      renderer: rendererRef.current ?? null,
    })
    const current = withGeometry(modelMeshes())
    if (current.length !== meshes.length || meshes.some((m, i) => m !== current[i])) {
      result.geometries.forEach((g) => g.dispose())
      throw new Error('The open model changed while repair was running')
    }
    const originals = meshes.map((m) => m.geometry)
    const originalMaterial = meshes[0].material
    meshes.forEach((m, i) => { m.geometry = result.geometries[i] })
    // The filled solid is one STL-style geometry without uv/color attributes;
    // the source material (possibly textured) would render it broken.
    const solidMaterial = new THREE.MeshStandardMaterial({
      color: getTheme(useViewerStore.getState().theme).modelColor, roughness: 0.85, metalness: 0,
    })
    meshes[0].material = solidMaterial
    return { meshes, originals, originalMaterial, solidMaterial, stats: result.stats }
  }

  const measureMarkerRadius = () => {
    const roots = modelRoots()
    if (roots.length === 0) return 0.01
    const box = new THREE.Box3()
    for (const root of roots) box.expandByObject(root)
    const s = box.getSize(new THREE.Vector3())
    return Math.max(Math.max(s.x, s.y, s.z) * 0.008, 1e-4)
  }

  const rebuildHoleOverlays = () => {
    const scene = sceneRef.current
    if (!scene) return
    const existing = holeOverlayRef.current
    if (existing) {
      disposeLoopOverlays(existing.entries)
      scene.remove(existing.group)
    }
    const materials = existing?.materials ?? makeOverlayMaterials(0x4c9ffe)
    const badge = existing?.badge ?? (() => {
      const el = document.createElement('div')
      el.className =
        'pointer-events-none absolute z-20 px-1.5 py-0.5 rounded text-[11px] ' +
        'bg-[var(--bg-elevated,#1e1e28)] text-[var(--text-primary,#fff)] shadow'
      el.style.display = 'none'
      mountRef.current?.appendChild(el)
      return el
    })()
    const group = new THREE.Group()
    group.userData.holeOverlay = true
    const meshes = withGeometry(modelMeshes())
    const { entries, skippedMeshes } = buildLoopOverlays(meshes, isRepairable, materials)
    for (const e of entries) group.add(e.group)
    scene.add(group)
    holeOverlayRef.current = { group, entries, hovered: -1, materials, badge }
    useViewerStore.getState().setHoleFillStatus({ loops: entries.length, skippedMeshes })
    invalidate()
  }

  const teardownHoleOverlays = () => {
    const scene = sceneRef.current
    const cur = holeOverlayRef.current
    if (cur && scene) {
      disposeLoopOverlays(cur.entries)
      scene.remove(cur.group)
      cur.materials.cap.dispose()
      cur.materials.capHover.dispose()
      cur.materials.outline.dispose()
      cur.badge.remove()
    }
    holeOverlayRef.current = null
    useViewerStore.getState().setHoleFillStatus(null)
    invalidate()
  }

  const applyLoopFill = (entry: OverlayEntry) => {
    const mesh = entry.mesh
    const before = withGeometry(modelMeshes())
    if (!before.includes(mesh)) return
    const original = mesh.geometry as THREE.BufferGeometry
    // entry.localPoints is the loop ring in this geometry's own local space, so
    // it KEY-matches the geometry's vertices directly. The overlay only ever
    // transforms points to world space for the cap/outline; the ring itself is
    // never moved, so no inverse-matrix round trip is needed here.
    const res = fillLoop(original, entry.localPoints)
    if (res.geometry === original || res.note) { res.geometry.dispose?.(); return }
    mesh.geometry = res.geometry
    pushUndo({
      label: 'Fill hole',
      apply: () => {
        if (mesh.geometry !== original) { (mesh.geometry as THREE.BufferGeometry).dispose(); mesh.geometry = original }
      },
      discard: () => original.dispose(),
    })
    rebuildHoleOverlays()
    for (const root of modelRoots()) applyViewMode(root, useViewerStore.getState().viewMode)
    updateTriangleDetails()
    updateGeometryDetails()
    invalidate()
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current)
    }
  }

  useImperativeHandle(ref, () => ({
    snapToView: (direction: ViewDirection) => {
      if (cameraRef.current && controlsRef.current && sceneRef.current) {
        snapToView(direction, cameraRef.current, controlsRef.current, sceneRef.current, animRef.current)
      }
    },
    fitAll: () => {
      if (cameraRef.current && controlsRef.current && sceneRef.current) {
        fitAll(cameraRef.current, controlsRef.current, sceneRef.current, animRef.current)
      }
    },
    resetCamera: () => {
      if (cameraRef.current && controlsRef.current && sceneRef.current) {
        resetCamera(cameraRef.current, controlsRef.current, sceneRef.current, animRef.current)
      }
    },
    zoomIn: () => {
      if (cameraRef.current && controlsRef.current) {
        zoomStep(cameraRef.current, controlsRef.current, 0.75)
      }
    },
    zoomOut: () => {
      if (cameraRef.current && controlsRef.current) {
        zoomStep(cameraRef.current, controlsRef.current, 1.333)
      }
    },
    orbitBy: (deltaTheta: number, deltaPhi: number) => {
      if (!cameraRef.current || !controlsRef.current) return
      const camera = cameraRef.current
      const controls = controlsRef.current
      const offset = new THREE.Vector3().subVectors(camera.position, controls.target)
      const spherical = new THREE.Spherical().setFromVector3(offset)
      spherical.theta -= deltaTheta
      spherical.phi -= deltaPhi
      spherical.phi = Math.max(0.01, Math.min(Math.PI - 0.01, spherical.phi))
      offset.setFromSpherical(spherical)
      camera.position.copy(controls.target).add(offset)
      camera.lookAt(controls.target)
      controls.update()
    },
    getCamera: () => cameraRef.current,
    getScene: () => sceneRef.current,
    getModelDimensions: () => {
      const roots = modelRoots()
      if (roots.length === 0) return null
      const box = new THREE.Box3()
      for (const root of roots) box.expandByObject(root)
      return box.getSize(new THREE.Vector3())
    },
    setModelUnit: (mm: number) => {
      let changed = false
      for (const root of modelRoots()) {
        if (typeof root.userData.modelUnitInMm !== 'number') {
          root.userData.modelUnitInMm = mm
          changed = true
        }
      }
      if (changed) updateGeometryDetails()
    },
    getModelDimensionsMm: () => {
      const roots = modelRoots()
      if (roots.length === 0) return null
      const box = new THREE.Box3()
      for (const root of roots) box.expandByObject(root)
      const size = box.getSize(new THREE.Vector3())
      const unit = useViewerStore.getState().geometryDetails?.modelUnitInMm ?? 1
      return size.multiplyScalar(unit)
    },
    scaleModelBy: (factor: number, label: string) => {
      const roots = modelRoots()
      if (roots.length === 0 || !Number.isFinite(factor) || factor <= 0) return
      const prev = roots.map((r) => r.scale.clone())
      roots.forEach((r) => r.scale.multiplyScalar(factor))
      pushUndo({
        label,
        apply: () => {
          modelRoots().forEach((r, i) => {
            if (prev[i]) r.scale.copy(prev[i])
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
    },
    resetMeasure: () => {
      const ov = measureOverlayRef.current
      if (!ov) return
      ov.pointA = null
      ov.pointB = null
      ov.markerA.visible = false
      ov.markerB.visible = false
      ov.line.visible = false
      if (measureBadgeRef.current) measureBadgeRef.current.style.display = 'none'
      useViewerStore.getState().setMeasureDistanceMm(null)
      invalidate()
    },
    moveModelBy: (delta: { x: number; y: number; z: number }) => {
      const roots = modelRoots()
      if (roots.length === 0) return
      const dx = Number.isFinite(delta.x) ? delta.x : 0
      const dy = Number.isFinite(delta.y) ? delta.y : 0
      const dz = Number.isFinite(delta.z) ? delta.z : 0
      const prev = roots.map((r) => r.position.clone())
      roots.forEach((r) => {
        r.position.x += dx
        r.position.y += dy
        r.position.z += dz
      })
      pushUndo({
        label: 'Move',
        apply: () => {
          modelRoots().forEach((r, i) => {
            if (prev[i]) r.position.copy(prev[i])
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
    },
    rotateModelBy: (deltaRad: { x: number; y: number; z: number }) => {
      const roots = modelRoots()
      if (roots.length === 0) return
      const rx = Number.isFinite(deltaRad.x) ? deltaRad.x : 0
      const ry = Number.isFinite(deltaRad.y) ? deltaRad.y : 0
      const rz = Number.isFinite(deltaRad.z) ? deltaRad.z : 0
      const prev = roots.map((r) => r.rotation.clone())
      roots.forEach((r) => {
        r.rotation.x += rx
        r.rotation.y += ry
        r.rotation.z += rz
      })
      pushUndo({
        label: 'Rotate',
        apply: () => {
          modelRoots().forEach((r, i) => {
            if (prev[i]) r.rotation.copy(prev[i])
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
    },
    scaleModelByAxes: (factors: { x: number; y: number; z: number }) => {
      const roots = modelRoots()
      if (roots.length === 0) return
      const fx = Number.isFinite(factors.x) && factors.x > 0 ? factors.x : 1
      const fy = Number.isFinite(factors.y) && factors.y > 0 ? factors.y : 1
      const fz = Number.isFinite(factors.z) && factors.z > 0 ? factors.z : 1
      const prev = roots.map((r) => r.scale.clone())
      roots.forEach((r) => {
        r.scale.x *= fx
        r.scale.y *= fy
        r.scale.z *= fz
      })
      pushUndo({
        label: 'Scale (free)',
        apply: () => {
          modelRoots().forEach((r, i) => {
            if (prev[i]) r.scale.copy(prev[i])
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
    },
    mirrorModel: (axis: 'x' | 'y' | 'z') => {
      const roots = modelRoots()
      if (roots.length === 0) return
      const prev = roots.map((r) => r.scale.clone())
      roots.forEach((r) => {
        r.scale[axis] *= -1
      })
      pushUndo({
        label: `Mirror ${axis.toUpperCase()}`,
        apply: () => {
          modelRoots().forEach((r, i) => {
            if (prev[i]) r.scale.copy(prev[i])
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
    },
    runRepair: async (stageIds, sealOpts, onProgress, signal) => {
      // Nothing requested: return before any snapshot so no undo closure is
      // built that would dispose then reassign the same live geometry.
      if (stageIds.length === 0) return { label: '', perMesh: [], skippedMeshes: 0 }

      const wantSeal = stageIds.includes('seal')
      const simpleIds = stageIds.filter((s): s is RepairStageId => s !== 'seal')
      const allMeshes = withGeometry(modelMeshes())
      if (allMeshes.length === 0) throw new Error('The scene has no mesh geometry to repair')

      // The simple stages emit position-only, groupless geometry. A mesh that
      // draws with an array material, or splits into more than one draw group,
      // renders nothing once the groups are gone; a uv or color attribute would
      // be silently stripped (textured -> one texel, vertexColors -> black) and
      // then exported that way. Such a mesh is skipped: its geometry and
      // material stay untouched and it is kept out of `originals` and the undo
      // entry. A plain single-group mesh (STL, single-material OBJ) is
      // repairable. Seal still collapses everything regardless.
      const repairable = allMeshes.filter(isRepairable)
      const skipped = allMeshes.filter((m) => !isRepairable(m))
      if (repairable.length === 0 && !wantSeal) {
        throw new Error('No repairable geometry: the model uses textures or multiple materials')
      }

      const originals = repairable.map((m) => m.geometry)
      const skippedOriginals = skipped.map((m) => m.geometry)

      // Put the repairable meshes back to their pre-run geometry, disposing
      // whatever intermediate currently sits on them. Shared by the seal-phase
      // failure rollback and the undo `apply` so the two cannot drift.
      const rollbackSimple = () => {
        repairable.forEach((m, i) => {
          if (m.geometry !== originals[i]) { m.geometry.dispose(); m.geometry = originals[i] }
        })
      }
      const refreshTail = () => {
        for (const root of modelRoots()) applyViewMode(root, useViewerStore.getState().viewMode)
        updateTriangleDetails()
        updateGeometryDetails()
        invalidate()
      }

      let perMesh: PerMeshStage[][] = []
      if (simpleIds.length && repairable.length) {
        const res = await runRepairInWorker(repairable, simpleIds, (p, phase) => onProgress(wantSeal ? p * 0.5 : p, phase), signal)
        const currentAll = withGeometry(modelMeshes())
        if (currentAll.length !== allMeshes.length || allMeshes.some((m, i) => m !== currentAll[i])) {
          res.geometries.forEach((g) => g.dispose())
          throw new Error('The open model changed while repair was running')
        }
        repairable.forEach((m, i) => { m.geometry = res.geometries[i] })
        perMesh = res.perMesh
      }

      let seal: SolidRepairStats | undefined
      let sealBits: Awaited<ReturnType<typeof applySeal>> | undefined
      if (wantSeal) {
        // Post simple-stage swap: what applySeal reads off the meshes. It swaps
        // every mesh's geometry again to the sealed soup, orphaning each
        // repairable mesh's intermediate — dispose those, never the pre-run
        // originals the undo entry restores.
        const preSeal = repairable.map((m) => m.geometry)
        try {
          sealBits = await applySeal(sealOpts.resolution, (p, phase) => onProgress(simpleIds.length ? 50 + p * 0.5 : p, phase), signal, { stripInternalWalls: sealOpts.stripInternalWalls })
        } catch (err) {
          // Cancel/Close (RepairDialog turns that into controller.abort()), a
          // seal worker error, or applySeal's own identity-guard throw: the
          // simple stages are already on the meshes. Restore the pre-run
          // geometry, drop the orphaned intermediates, refresh the panel, then
          // rethrow — no undo entry is pushed.
          rollbackSimple()
          refreshTail()
          throw err
        }
        const attachedNow = new Set(modelMeshes().map((m) => m.geometry))
        preSeal.forEach((g) => { if (!originals.includes(g) && !attachedNow.has(g)) g.dispose() })
        seal = sealBits.stats
      }

      const label = stageIds.length > 1 ? 'Repair all' : STAGE_LABEL[stageIds[0]]
      const sealMeshes = sealBits?.meshes
      const solidMaterial = sealBits?.solidMaterial
      const originalMaterial = sealBits?.originalMaterial
      pushUndo({
        label,
        apply: () => {
          rollbackSimple()
          if (sealMeshes && originalMaterial !== undefined) {
            // applySeal swapped every mesh (repairable + skipped) to the sealed
            // soup. rollbackSimple has already restored the repairable ones;
            // restore the skipped meshes and the collapsed material.
            skipped.forEach((m, i) => { m.geometry.dispose(); m.geometry = skippedOriginals[i] })
            sealMeshes[0].material = originalMaterial
            solidMaterial?.dispose()
          }
        },
        discard: () => {
          originals.forEach((g) => g.dispose())
          if (originalMaterial !== undefined) {
            // Seal ran, so the skipped meshes' original geometry is orphaned too.
            skippedOriginals.forEach((g) => g.dispose())
            for (const mat of Array.isArray(originalMaterial) ? originalMaterial : [originalMaterial]) mat.dispose()
          }
        },
      })

      if (wantSeal) useViewerStore.getState().setSealApplied(true)
      refreshTail()
      // A long worker run can leave the RAF loop throttled (backgrounded tab or
      // mobile), so the demand-render bump in refreshTail may not paint for
      // seconds. Force one synchronous frame so the repair shows at once.
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current)
      }
      return { label, perMesh, seal, skippedMeshes: skipped.length }
    },
    getSplitPart: (id: string) => splitPartsRef.current.get(id),

    splitByShell: () => {
      const scene = sceneRef.current
      if (!scene) throw new Error('Split by shell needs an open 3D view')
      if (useViewerStore.getState().loadedModels.length > 0)
        throw new Error('Split by shell works on a single open model')
      const original = modelGroupRef.current
      if (!original) throw new Error('Split by shell works on a single open model')
      if (splitPartsGroupRef.current) throw new Error('Already split — undo Split by shell first')

      const meshes = withGeometry(modelMeshes()).filter(isRepairable)
      if (meshes.length === 0)
        throw new Error('No splittable mesh: the model uses textures or multiple materials')
      if (meshes.length > 1)
        throw new Error('Split by shell needs a single-mesh model')

      const mesh = meshes[0]
      const res = splitGeometryByShell(mesh.geometry as THREE.BufferGeometry)
      if (res.parts.length < 2) {
        res.parts.forEach((g) => g.dispose())
        throw new Error('Nothing to split: the model is a single connected shell')
      }

      mesh.updateWorldMatrix(true, false)
      const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3()
      mesh.matrixWorld.decompose(pos, quat, scl)

      const theme = getTheme(useViewerStore.getState().theme)
      const base = baseModelName()
      const group = new THREE.Group()
      group.userData.splitGroup = true

      const partMeta: { id: string; name: string; triangleCount: number; visible: boolean }[] = []
      res.parts.forEach((geo, i) => {
        const srcMat = mesh.material as THREE.Material
        const mat = srcMat.clone() as THREE.Material & { color?: THREE.Color }
        if (mat.color instanceof THREE.Color && mat.color.getHex() === 0xB0B0B0) mat.color.setHex(theme.modelColor)
        const partMesh = new THREE.Mesh(geo, mat)
        partMesh.position.copy(pos)
        partMesh.quaternion.copy(quat)
        partMesh.scale.copy(scl)
        const id = crypto.randomUUID()
        partMesh.userData.splitPartId = id
        partMesh.name = `${base} — part ${i + 1}`
        group.add(partMesh)
        splitPartsRef.current.set(id, partMesh)
        partMeta.push({
          id, name: partMesh.name,
          triangleCount: (geo.getAttribute('position') as THREE.BufferAttribute).count / 3,
          visible: true,
        })
      })

      // Retain `original` + defer its disposal to the undo entry. Null the ref
      // so modelRoots() yields only the new part group — otherwise the detached
      // original double-counts in updateTriangleDetails / updateGeometryDetails
      // and view mode is applied to a dead object.
      scene.remove(original)
      modelGroupRef.current = undefined
      scene.add(group)
      splitPartsGroupRef.current = group
      useViewerStore.getState().setSplitParts(partMeta)

      pushUndo({
        label: 'Split by shell',
        apply: () => {
          teardownSplitParts()
          scene.add(original)
          modelGroupRef.current = original
          useViewerStore.getState().setSplitParts([])
        },
        discard: () => { disposeModel(original, scene) },
      })

      for (const root of modelRoots()) applyViewMode(root, useViewerStore.getState().viewMode)
      updateTriangleDetails()
      updateGeometryDetails()
      invalidate()
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current)
      }
      return { parts: res.parts.length, droppedFragments: res.droppedFragments }
    },

    undoEdit: (steps = 1) => {
      popApply(undoStackRef.current, clampUndoSteps(steps, undoStackRef.current.length))
      // A full drain means nothing sealed remains on the model; the residual
      // watertight/manifold banner must clear with it. A partial undo that
      // leaves older entries keeps the flag (accepted, design spec §7).
      if (undoStackRef.current.length === 0) useViewerStore.getState().setSealApplied(false)
      syncUndoLabels()
      const roots = modelRoots()
      for (const root of roots) applyViewMode(root, useViewerStore.getState().viewMode)
      updateTriangleDetails()
      updateGeometryDetails()
      refreshSceneEnvironment()
      invalidate()
    },
  }))

  // Effect 1: Renderer initialization (StrictMode-safe via rendererRef guard)
  useEffect(() => {
    // StrictMode guard — skip re-initialization on second mount
    if (rendererRef.current) return
    if (!mountRef.current) return

    const container = mountRef.current

    // Scene
    const scene = new THREE.Scene()
    // Initial background — will be replaced by theme effect
    scene.background = new THREE.Color(0x2D2D2D)

    // Camera
    const camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      10000
    )
    camera.position.set(0, 0, 100)

    // Renderer — context creation fails when WebGL is unavailable
    // (GPU blocklisted, hardware acceleration disabled, remote desktop)
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch {
      useViewerStore
        .getState()
        .setError(
          '3D view unavailable: WebGL2 could not be initialized. Chrome/Edge: turn on "Use hardware acceleration" in chrome://settings/system and reload (chrome://gpu shows GPU status). Firefox usually works without changes.'
        )
      return
    }
    // Cap initial DPR — HiDPI 3x-4x quadruples fill cost; settings can raise it
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.2
    container.appendChild(renderer.domElement)

    // Lighting — store refs for dynamic light management
    const hemisphere = new THREE.HemisphereLight(0xddeeff, 0x0d0d0d, 0.8)
    scene.add(hemisphere)
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2)
    keyLight.position.set(5, 10, 7)
    keyLight.name = 'keyLight'
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0xb0c4de, 0.6)
    fillLight.position.set(-5, 5, -5)
    fillLight.name = 'fillLight'
    scene.add(fillLight)
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.3)
    rimLight.position.set(0, -3, -8)
    rimLight.name = 'rimLight'
    scene.add(rimLight)
    lightsRef.current = [hemisphere, keyLight, fillLight, rimLight]

    // Grid helper for spatial reference (VIEW-07) — default size, replaced on model load
    const grid = new THREE.GridHelper(200, 20, 0x444466, 0x333355)
    ;(grid as any)._divisions = 20
    ;(grid as any)._gridSize = 200
    scene.add(grid)
    gridRef.current = grid

    // OrbitControls — Fusion 360 style:
    // Left-drag = orbit, Middle-drag = pan (hand tool), Scroll = zoom
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    }

    // Double-click to re-center orbit on clicked point — raycast to model
    // surface and move the orbit target there. This lets users focus on
    // specific parts of large/tall models, then scroll-zoom works toward
    // that new center.
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()
    const onDblClick = (e: MouseEvent) => {
      // Collect all models (both preview and multi-model) for raycasting
      const targets: THREE.Object3D[] = []
      if (modelGroupRef.current) targets.push(modelGroupRef.current)
      for (const obj of modelMapRef.current.values()) targets.push(obj)
      if (splitPartsGroupRef.current) targets.push(splitPartsGroupRef.current)
      if (targets.length === 0) return

      const rect = renderer.domElement.getBoundingClientRect()
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObjects(targets, true)
      if (hits.length > 0) {
        controls.target.copy(hits[0].point)
        controls.update()
      }
    }
    renderer.domElement.addEventListener('dblclick', onDblClick)
    dblClickRef.current = { el: renderer.domElement, fn: onDblClick }

    // WebGL context loss (GPU reset, memory pressure, another context evicted
    // this one) leaves the canvas blank. preventDefault on the loss event is
    // what lets the browser fire 'restored'; without it the context stays dead,
    // which is why mobile never recovered. three re-uploads GPU resources
    // lazily on the next render after restore.
    const onContextLost = (e: Event) => { e.preventDefault(); framesToRenderRef.current = 0 }
    const onContextRestored = () => { refreshSceneEnvironment(); invalidate() }
    renderer.domElement.addEventListener('webglcontextlost', onContextLost, false)
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored, false)
    contextRef.current = { el: renderer.domElement, lost: onContextLost, restored: onContextRestored }

    // Store refs
    sceneRef.current = scene
    rendererRef.current = renderer
    cameraRef.current = camera
    controlsRef.current = controls

    // Redraw whenever controls apply movement (drag, wheel, damping decay,
    // programmatic target moves like double-click recenter)
    controls.addEventListener('change', invalidate)
    // Any store mutation may change what's on screen (model load completion,
    // view mode, theme, lights, settings) — cheap over-invalidation
    const unsubscribeStore = useViewerStore.subscribe(invalidate)

    // Animation loop — uses refs so renderer/controls recreation in Effect 7 is picked up
    const animate = () => {
      animIdRef.current = requestAnimationFrame(animate)
      const animActive = tickCameraAnimation(animRef.current, cameraRef.current!, controlsRef.current!)
      // update() returns true while it moves the camera (including damping)
      const controlsMoved = controlsRef.current?.update() ?? false
      if (animActive || controlsMoved || framesToRenderRef.current > 0) {
        if (framesToRenderRef.current > 0) framesToRenderRef.current--
        if (rendererRef.current && sceneRef.current && cameraRef.current) {
          rendererRef.current.render(sceneRef.current, cameraRef.current)
        }
      }
    }
    animate()

    return () => {
      previewVersionRef.current++
      unsubscribeStore()
      if (dblClickRef.current) {
        dblClickRef.current.el.removeEventListener('dblclick', dblClickRef.current.fn)
        dblClickRef.current = null
      }
      if (contextRef.current) {
        contextRef.current.el.removeEventListener('webglcontextlost', contextRef.current.lost)
        contextRef.current.el.removeEventListener('webglcontextrestored', contextRef.current.restored)
        contextRef.current = null
      }
      cancelAnimationFrame(animIdRef.current)
      // Effect 7 may have replaced the renderer/controls (antialias toggle);
      // dispose the live instances, not the originals captured above.
      const liveControls = controlsRef.current
      const liveRenderer = rendererRef.current
      if (liveControls) liveControls.dispose()
      if (liveRenderer) {
        liveRenderer.dispose()
        if (container.contains(liveRenderer.domElement)) {
          container.removeChild(liveRenderer.domElement)
        }
      }
      teardownSplitParts()
      disposeViewerResources(
        scene,
        modelGroupRef.current,
        modelMapRef.current.values(),
        gridRef.current
      )
      modelGroupRef.current = undefined
      modelMapRef.current.clear()
      loadingIdsRef.current.clear()
      useViewerStore.getState().setPendingModelLoads(0)
      gridRef.current = undefined
      lightsRef.current = []
      sceneRef.current = undefined
      cameraRef.current = undefined
      rendererRef.current = undefined
      controlsRef.current = undefined
    }
  }, [])

  // Effect 2: Single-model preview — disposes previous model and multi-model
  // scene, loads new model centered, updates triangleCount
  const fileBuffer = useViewerStore((s) => s.fileBuffer)
  useEffect(() => {
    // Bump even when clearing (filePath -> null) so an in-flight load from a
    // previous run is detected as stale and disposed when it resolves
    const version = ++previewVersionRef.current
    // Tearing down the preview (filePath -> null) must also drop the undo
    // stack, or a dead "Undo" button and stale undo-history rows outlive the
    // model. Harmless no-op on an already-empty stack.
    clearUndo()
    useViewerStore.getState().setHoleFillMode(false)
    teardownSplitParts()
    useViewerStore.getState().setSplitParts([])
    if (!filePath || !fileExtension || !sceneRef.current || !cameraRef.current) {
      // Clearing the preview must also remove a committed model from the
      // scene — the viewer stays mounted when multi-model entries remain
      if (modelGroupRef.current && sceneRef.current) {
        disposeModel(modelGroupRef.current, sceneRef.current)
        modelGroupRef.current = undefined
      }
      // A load superseded by a clear skips its own setLoading(false)
      useViewerStore.getState().setLoading(false)
      return
    }

    const scene = sceneRef.current
    const { setLoading, setError, setTriangleCount, clearModels } = useViewerStore.getState()

    setLoading(true)
    setError(null)

    // Clear any multi-model scene — preview replaces everything
    for (const obj of modelMapRef.current.values()) {
      disposeModel(obj, scene)
    }
    modelMapRef.current.clear()
    loadingIdsRef.current.clear()
    useViewerStore.getState().setPendingModelLoads(0)
    clearModels()

    // Dispose previous preview model if any
    if (modelGroupRef.current) {
      disposeModel(modelGroupRef.current, scene)
      modelGroupRef.current = undefined
    }

    // Browser-supplied files (drag-and-drop / file input) carry their bytes
    // in the store; native files are read by path over Tauri IPC
    const onStatus = (label: string) => {
      if (previewVersionRef.current === version) {
        useViewerStore.getState().setProgressStatus({ label, percent: null })
      }
    }
    const loadPromise = fileBuffer
      ? loadModelFromBuffer(fileBuffer, fileExtension, scene, cameraRef.current, { onStatus })
      : loadModel(filePath, fileExtension, scene, cameraRef.current, { onStatus })

    loadPromise
      .then((obj) => {
        if (previewVersionRef.current !== version) {
          // Stale resolution — a newer load started or the preview was cleared
          disposeModel(obj, scene)
          return
        }
        modelGroupRef.current = obj
        setTriangleCount(countTriangles(obj))
        updateGeometryDetails()
        // Apply current view mode to newly loaded model
        applyViewMode(obj, useViewerStore.getState().viewMode)

        // Force world matrix update before computing bounding box
        obj.updateMatrixWorld(true)
        const box = new THREE.Box3().setFromObject(obj)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)

        // Set orbit target to model's vertical + horizontal center
        if (controlsRef.current) {
          controlsRef.current.target.set(center.x, center.y, center.z)
          // Also point camera at the center
          cameraRef.current!.lookAt(center)
          controlsRef.current.update()
        }

        // Scale grid to fit the model
        if (sceneRef.current && gridRef.current) {
          sceneRef.current.remove(gridRef.current)
          gridRef.current.dispose()
          const gridSize = maxDim * 3
          const { gridDivisions } = getEffectiveSettings(
            useViewerStore.getState().performancePreset,
            useViewerStore.getState().performanceOverrides
          )
          const themeGrid = getTheme(useViewerStore.getState().theme)
          const newGrid = new THREE.GridHelper(gridSize, gridDivisions, themeGrid.gridPrimary, themeGrid.gridSecondary)
          ;(newGrid as any)._divisions = gridDivisions
          ;(newGrid as any)._gridSize = gridSize
          sceneRef.current.add(newGrid)
          gridRef.current = newGrid
        }

        // Apply theme-aware model color
        const themeColors = getTheme(useViewerStore.getState().theme)
        obj.traverse((child: THREE.Object3D) => {
          if (child instanceof THREE.Mesh) {
            const mats = Array.isArray(child.material) ? child.material : [child.material]
            for (const mat of mats) {
              if (mat && 'color' in mat && mat.color instanceof THREE.Color) {
                if (mat.color.getHex() === 0xB0B0B0) {
                  mat.color.setHex(themeColors.modelColor)
                }
              }
            }
          }
        })
      })
      .catch((err: unknown) => {
        if (previewVersionRef.current !== version) return
        const message = err instanceof Error ? err.message : 'Failed to load model'
        setError(message)
      })
      .finally(() => {
        if (previewVersionRef.current === version) {
          setLoading(false)
          useViewerStore.getState().setProgressStatus(null)
        }
      })
  }, [filePath, fileExtension, fileBuffer])

  // Effect 3: View mode switching — applies to preview model AND all multi-model entries
  useEffect(() => {
    if (modelGroupRef.current) {
      applyViewMode(modelGroupRef.current, viewMode)
    }
    for (const obj of modelMapRef.current.values()) {
      applyViewMode(obj, viewMode)
    }
    if (splitPartsGroupRef.current) {
      applyViewMode(splitPartsGroupRef.current, viewMode)
    }
  }, [viewMode])

  // Effect 4: Container resize — updates renderer when panels open/close or window resizes
  useEffect(() => {
    if (!mountRef.current) return

    let resizeScheduled = false
    const handleResize = () => {
      if (resizeScheduled) return
      resizeScheduled = true
      requestAnimationFrame(() => {
        resizeScheduled = false
        if (!mountRef.current || !rendererRef.current || !cameraRef.current) return
        const width = mountRef.current.clientWidth
        const height = mountRef.current.clientHeight
        if (width === 0 || height === 0) return
        rendererRef.current.setSize(width, height)
        const cam = cameraRef.current
        if (cam instanceof THREE.PerspectiveCamera) {
          cam.aspect = width / height
          cam.updateProjectionMatrix()
        } else if (cam instanceof THREE.OrthographicCamera) {
          // Preserve current visible height, just adjust aspect ratio
          const currentHeight = cam.top - cam.bottom
          const halfHeight = currentHeight / 2
          const halfWidth = halfHeight * (width / height)
          cam.left = -halfWidth
          cam.right = halfWidth
          cam.updateProjectionMatrix()
        }
        invalidate()
      })
    }

    const observer = new ResizeObserver(handleResize)
    observer.observe(mountRef.current)

    return () => {
      observer.disconnect()
    }
  }, [])

  // Effect 5: Multi-model management — diffs loadedModels against modelMapRef
  // to add/remove models without touching the preview path
  const theme = useViewerStore((s) => s.theme)
  const loadedModels = useViewerStore((s) => s.loadedModels)
  const loadKey = modelLoadKey(loadedModels)
  useEffect(() => {
    if (!sceneRef.current || !cameraRef.current || !controlsRef.current) return

    const scene = sceneRef.current
    const camera = cameraRef.current

    const currentIds = new Set(modelMapRef.current.keys())
    const nextIds = new Set(loadedModels.map((m) => m.id))
    if (currentIds.size !== nextIds.size || [...currentIds].some((id) => !nextIds.has(id))) {
      clearUndo()
      useViewerStore.getState().setHoleFillMode(false)
      teardownSplitParts()
      useViewerStore.getState().setSplitParts([])
    }

    // Find removed IDs — dispose and delete from map
    for (const id of currentIds) {
      if (!nextIds.has(id)) {
        const obj = modelMapRef.current.get(id)
        if (obj) {
          disposeModel(obj, scene)
        }
        modelMapRef.current.delete(id)
      }
    }

    // Find added IDs — load model with center=false, update triangle count
    // Check both currentIds and loadingIdsRef to prevent duplicate loads
    const addPromises: Promise<void>[] = []
    for (const model of loadedModels) {
      if (!currentIds.has(model.id) && !loadingIdsRef.current.has(model.id)) {
        loadingIdsRef.current.add(model.id)
        useViewerStore.getState().setPendingModelLoads(loadingIdsRef.current.size)
        const promise = loadModel(model.path, model.extension, scene, camera, { center: false })
          .then((obj) => {
            // The model may have been removed (or the scene cleared by the
            // single-file preview path) while the load was in flight —
            // committing it would orphan the mesh in the scene forever
            const stillLoaded = useViewerStore
              .getState()
              .loadedModels.some((m) => m.id === model.id)
            if (sceneRef.current !== scene || !stillLoaded) {
              disposeModel(obj, scene)
              return
            }
            modelMapRef.current.set(model.id, obj)
            // Apply current view mode immediately
            applyViewMode(obj, useViewerStore.getState().viewMode)
            // Apply theme-aware model color
            const tc = getTheme(useViewerStore.getState().theme)
            obj.traverse((child: THREE.Object3D) => {
              if (child instanceof THREE.Mesh) {
                const mats = Array.isArray(child.material) ? child.material : [child.material]
                for (const mat of mats) {
                  if (mat && 'color' in mat && mat.color instanceof THREE.Color) {
                    if (mat.color.getHex() === 0xB0B0B0) {
                      mat.color.setHex(tc.modelColor)
                    }
                  }
                }
              }
            })
            // Update triangle count in store so ModelList shows real counts
            const count = countTriangles(obj)
            useViewerStore.getState().updateModelTriangles(model.id, count)
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : 'Failed to load model'
            useViewerStore.getState().setError(message)
          })
          .finally(() => {
            loadingIdsRef.current.delete(model.id)
            useViewerStore.getState().setPendingModelLoads(loadingIdsRef.current.size)
          })
        addPromises.push(promise)
      }
    }

    // After all adds complete, fit camera to all multi-model objects.
    // Removal-only and metadata-only updates (triangle counts) must not
    // re-fit — the user's camera position would jump for no reason.
    if (addPromises.length === 0) return
    Promise.all(addPromises).then(() => {
      updateGeometryDetails()
      if (sceneRef.current !== scene || loadingIdsRef.current.size > 0) return
      const allObjects = [...modelMapRef.current.values()]
      if (allObjects.length > 0 && cameraRef.current && controlsRef.current) {
        fitAllModels(allObjects, cameraRef.current, controlsRef.current)

        // Scale and position grid to union bounding box
        if (sceneRef.current && gridRef.current) {
          const unionBox = new THREE.Box3()
          for (const obj of allObjects) {
            obj.updateMatrixWorld(true)
            unionBox.union(new THREE.Box3().setFromObject(obj))
          }
          const size = unionBox.getSize(new THREE.Vector3())
          const maxDim = Math.max(size.x, size.y, size.z)
          const center = unionBox.getCenter(new THREE.Vector3())
          sceneRef.current.remove(gridRef.current)
          gridRef.current.dispose()
          const gridSize = maxDim * 3
          const { gridDivisions } = getEffectiveSettings(
            useViewerStore.getState().performancePreset,
            useViewerStore.getState().performanceOverrides
          )
          const themeGrid = getTheme(useViewerStore.getState().theme)
          const newGrid = new THREE.GridHelper(gridSize, gridDivisions, themeGrid.gridPrimary, themeGrid.gridSecondary)
          ;(newGrid as any)._divisions = gridDivisions
          ;(newGrid as any)._gridSize = gridSize
          newGrid.position.set(center.x, unionBox.min.y, center.z)
          sceneRef.current.add(newGrid)
          gridRef.current = newGrid
        }
      }
    })
  }, [loadKey])

  // Effect 6: Projection mode toggle — swap between perspective and orthographic
  const projectionMode = useViewerStore((s) => s.projectionMode)
  const performancePreset = useViewerStore((s) => s.performancePreset)
  const performanceOverrides = useViewerStore((s) => s.performanceOverrides)
  useEffect(() => {
    if (!mountRef.current || !rendererRef.current || !controlsRef.current || !sceneRef.current) return

    const container = mountRef.current
    const width = container.clientWidth
    const height = container.clientHeight
    const oldCamera = cameraRef.current
    if (!oldCamera) return

    const currentPos = oldCamera.position.clone()
    const currentTarget = controlsRef.current.target.clone()
    const currentUp = oldCamera.up.clone()

    if (projectionMode === 'orthographic' && oldCamera instanceof THREE.PerspectiveCamera) {
      const distance = currentPos.distanceTo(currentTarget)
      const halfHeight = distance * Math.tan(THREE.MathUtils.degToRad(oldCamera.fov / 2))
      const halfWidth = halfHeight * (width / height)

      const orthoCamera = new THREE.OrthographicCamera(
        -halfWidth, halfWidth, halfHeight, -halfHeight,
        oldCamera.near, oldCamera.far
      )
      orthoCamera.position.copy(currentPos)
      orthoCamera.up.copy(currentUp)
      orthoCamera.lookAt(currentTarget)

      cameraRef.current = orthoCamera
      controlsRef.current.object = orthoCamera
      controlsRef.current.update()
    } else if (projectionMode === 'perspective' && oldCamera instanceof THREE.OrthographicCamera) {
      const perspCamera = perspectiveCameraFrom(oldCamera, width, height)
      perspCamera.lookAt(currentTarget)

      cameraRef.current = perspCamera
      controlsRef.current.object = perspCamera
      controlsRef.current.update()
    }
  }, [projectionMode])

  // Effect 7: Apply performance settings — in-place reconfiguration
  useEffect(() => {
    const settings = getEffectiveSettings(performancePreset, performanceOverrides)

    // Antialiasing — requires renderer recreation
    if (rendererRef.current && mountRef.current && settings.antialias !== antialiasRef.current) {
      const container = mountRef.current
      const oldRenderer = rendererRef.current

      // Keep the working renderer if a replacement context cannot be created
      let newRenderer: THREE.WebGLRenderer
      try {
        newRenderer = new THREE.WebGLRenderer({ antialias: settings.antialias })
      } catch {
        return
      }
      newRenderer.setPixelRatio(settings.pixelRatio)
      newRenderer.setSize(container.clientWidth, container.clientHeight)
      newRenderer.toneMapping = settings.toneMapping
      newRenderer.toneMappingExposure = settings.toneMappingExposure

      // Swap DOM elements
      container.removeChild(oldRenderer.domElement)
      container.appendChild(newRenderer.domElement)
      oldRenderer.dispose()

      // Reconnect OrbitControls to new DOM element, preserving orbit target
      if (controlsRef.current) {
        const prevTarget = controlsRef.current.target.clone()
        controlsRef.current.dispose()
        const controls = new OrbitControls(cameraRef.current!, newRenderer.domElement)
        controls.enableDamping = settings.damping
        controls.mouseButtons = {
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT: THREE.MOUSE.PAN,
        }
        controls.target.copy(prevTarget)
        controls.update()
        controls.addEventListener('change', invalidate)
        controlsRef.current = controls
      }

      // Re-attach double-click handler (detach the previous one first)
      if (dblClickRef.current) {
        dblClickRef.current.el.removeEventListener('dblclick', dblClickRef.current.fn)
      }
      const raycaster = new THREE.Raycaster()
      const mouse = new THREE.Vector2()
      const onDblClick = (e: MouseEvent) => {
        const targets: THREE.Object3D[] = []
        if (modelGroupRef.current) targets.push(modelGroupRef.current)
        for (const obj of modelMapRef.current.values()) targets.push(obj)
        if (splitPartsGroupRef.current) targets.push(splitPartsGroupRef.current)
        if (targets.length === 0) return
        const rect = newRenderer.domElement.getBoundingClientRect()
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
        raycaster.setFromCamera(mouse, cameraRef.current!)
        const hits = raycaster.intersectObjects(targets, true)
        if (hits.length > 0) {
          controlsRef.current!.target.copy(hits[0].point)
          controlsRef.current!.update()
        }
      }
      newRenderer.domElement.addEventListener('dblclick', onDblClick)
      dblClickRef.current = { el: newRenderer.domElement, fn: onDblClick }

      // Move the context-loss handlers to the replacement canvas.
      if (contextRef.current) {
        contextRef.current.el.removeEventListener('webglcontextlost', contextRef.current.lost)
        contextRef.current.el.removeEventListener('webglcontextrestored', contextRef.current.restored)
        const lost = (e: Event) => { e.preventDefault(); framesToRenderRef.current = 0 }
        const restored = () => { refreshSceneEnvironment(); invalidate() }
        newRenderer.domElement.addEventListener('webglcontextlost', lost, false)
        newRenderer.domElement.addEventListener('webglcontextrestored', restored, false)
        contextRef.current = { el: newRenderer.domElement, lost, restored }
      }

      rendererRef.current = newRenderer
      antialiasRef.current = settings.antialias
      // Wake Effect 9 so hole-fill pick listeners rebind to the new canvas.
      setRendererGen((g) => g + 1)

    }

    // Pixel ratio
    if (rendererRef.current) {
      rendererRef.current.setPixelRatio(settings.pixelRatio)
      if (mountRef.current) {
        rendererRef.current.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight)
      }
    }

    // Tone mapping
    if (rendererRef.current) {
      rendererRef.current.toneMapping = settings.toneMapping
      rendererRef.current.toneMappingExposure = settings.toneMappingExposure
    }

    // Damping
    if (controlsRef.current) {
      controlsRef.current.enableDamping = settings.damping
    }

    // Lights — show/hide based on maxLights
    // Order: [0]=hemisphere (always on), [1]=key (always on), [2]=fill, [3]=rim
    const lights = lightsRef.current
    if (lights.length === 4) {
      lights[0].visible = true   // hemisphere — always
      lights[1].visible = true   // key — always
      lights[2].visible = settings.maxLights >= 3  // fill
      lights[3].visible = settings.maxLights >= 4  // rim
    }

    // Grid divisions — rebuild grid if different
    if (gridRef.current && sceneRef.current) {
      // Check current grid divisions by comparing geometry
      const currentDivs = (gridRef.current as any)._divisions as number | undefined
      if (currentDivs !== settings.gridDivisions) {
        const oldGrid = gridRef.current
        const pos = oldGrid.position.clone()
        const gridSize = (oldGrid as any)._gridSize ?? 200
        sceneRef.current.remove(oldGrid)
        oldGrid.dispose()
        const themeGrid = getTheme(useViewerStore.getState().theme)
        const newGrid = new THREE.GridHelper(gridSize, settings.gridDivisions, themeGrid.gridPrimary, themeGrid.gridSecondary)
        newGrid.position.copy(pos)
        ;(newGrid as any)._divisions = settings.gridDivisions
        ;(newGrid as any)._gridSize = gridSize
        sceneRef.current.add(newGrid)
        gridRef.current = newGrid
      }
    }
  }, [performancePreset, performanceOverrides])

  // Effect 8: Theme — update scene background, grid, lights, and model materials
  useEffect(() => {
    const colors = getTheme(theme)

    // Scene background — solid color or gradient
    if (sceneRef.current) {
      // Dispose old background texture if it exists
      if (sceneRef.current.background instanceof THREE.Texture) {
        sceneRef.current.background.dispose()
      }

      if (colors.sceneBgTop === colors.sceneBgBottom) {
        // Solid color — avoids tone mapping artifacts from texture backgrounds
        sceneRef.current.background = new THREE.Color(colors.sceneBgTop)
      } else {
        // Gradient via canvas texture
        const canvas = document.createElement('canvas')
        canvas.width = 2
        canvas.height = 256
        const ctx = canvas.getContext('2d')!
        const topColor = new THREE.Color(colors.sceneBgTop)
        const bottomColor = new THREE.Color(colors.sceneBgBottom)
        const gradient = ctx.createLinearGradient(0, 0, 0, 256)
        gradient.addColorStop(0, `#${topColor.getHexString()}`)
        gradient.addColorStop(1, `#${bottomColor.getHexString()}`)
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, 2, 256)
        const texture = new THREE.CanvasTexture(canvas)
        texture.colorSpace = THREE.LinearSRGBColorSpace
        texture.needsUpdate = true
        sceneRef.current.background = texture
      }
    }

    // Grid colors
    if (gridRef.current && sceneRef.current) {
      const oldGrid = gridRef.current
      const pos = oldGrid.position.clone()
      const gridSize = (oldGrid as any)._gridSize ?? 200
      const divs = (oldGrid as any)._divisions ?? 20
      sceneRef.current.remove(oldGrid)
      oldGrid.dispose()
      const newGrid = new THREE.GridHelper(gridSize, divs, colors.gridPrimary, colors.gridSecondary)
      ;(newGrid as any)._divisions = divs
      ;(newGrid as any)._gridSize = gridSize
      newGrid.position.copy(pos)
      sceneRef.current.add(newGrid)
      gridRef.current = newGrid
    }

    // Lighting
    const lights = lightsRef.current
    if (lights.length >= 2) {
      const hemi = lights[0] as THREE.HemisphereLight
      hemi.color.setHex(colors.hemisphereSky)
      hemi.groundColor.setHex(colors.hemisphereGround)
      const key = lights[1] as THREE.DirectionalLight
      key.intensity = colors.keyLightIntensity
      if (lights.length >= 3) {
        const fill = lights[2] as THREE.DirectionalLight
        fill.intensity = colors.fillLightIntensity
      }
    }

    // Model material color — update existing loaded models
    const updateMaterial = (obj: THREE.Object3D) => {
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const materials = Array.isArray(child.material) ? child.material : [child.material]
          for (const mat of materials) {
            if (mat && 'color' in mat && mat.color instanceof THREE.Color) {
              // Only update default gray materials (not textured/colored models like GLTF)
              const hex = mat.color.getHex()
              if (hex === 0xB0B0B0 || hex === 0x909090) {
                mat.color.setHex(colors.modelColor)
              }
            }
          }
        }
      })
    }

    if (modelGroupRef.current) {
      updateMaterial(modelGroupRef.current)
    }
    for (const obj of modelMapRef.current.values()) {
      updateMaterial(obj)
    }
    if (splitPartsGroupRef.current) {
      updateMaterial(splitPartsGroupRef.current)
    }
  }, [theme])

  // Effect 9: Hole-fill pick mode — overlay lifecycle + pointer/click/key wiring.
  // Placed after the renderer effect so rendererRef / cameraRef are populated.
  const holeFillMode = useViewerStore((s) => s.holeFillMode)
  const repairDialogOpen = useViewerStore((s) => s.repairDialogOpen)
  useEffect(() => {
    if (!holeFillMode) return
    const el = rendererRef.current?.domElement
    const mount = mountRef.current
    if (!el || !mount) return

    rebuildHoleOverlays()

    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const setRay = (e: PointerEvent | MouseEvent) => {
      const rect = el.getBoundingClientRect()
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, cameraRef.current!)
    }

    let downX = 0, downY = 0
    const onDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY }

    const onMove = (e: PointerEvent) => {
      const st = holeOverlayRef.current
      if (!st) return
      setRay(e)
      const hit = pickOverlay(st.entries, raycaster)
      if (hit !== st.hovered) {
        if (st.hovered >= 0) st.entries[st.hovered].cap.material = st.materials.cap
        if (hit >= 0) st.entries[hit].cap.material = st.materials.capHover
        st.hovered = hit
        invalidate()
      }
      if (hit >= 0) {
        const c = new THREE.Vector3()
        st.entries[hit].cap.geometry.computeBoundingBox()
        st.entries[hit].cap.geometry.boundingBox!.getCenter(c)
        c.project(cameraRef.current!)
        const rect = el.getBoundingClientRect()
        st.badge.textContent = `${st.entries[hit].loop.vertexCount} vertices`
        st.badge.style.left = `${(c.x * 0.5 + 0.5) * rect.width}px`
        st.badge.style.top = `${(-c.y * 0.5 + 0.5) * rect.height}px`
        st.badge.style.display = ''
      } else {
        st.badge.style.display = 'none'
      }
    }

    const onClick = (e: MouseEvent) => {
      const st = holeOverlayRef.current
      if (!st || st.hovered < 0) return
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 4) return // was a drag
      applyLoopFill(st.entries[st.hovered])
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useViewerStore.getState().setHoleFillMode(false)
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('click', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey)
      teardownHoleOverlays()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeFillMode, rendererGen])

  // Effect 10: Auto-disarm pick mode when the Repair dialog opens
  useEffect(() => {
    if (repairDialogOpen && holeFillMode) useViewerStore.getState().setHoleFillMode(false)
  }, [repairDialogOpen, holeFillMode])

  // Effect 10b: Measure mode — overlay lifecycle + pointer/click/key wiring.
  const measureMode = useViewerStore((s) => s.measureMode)
  useEffect(() => {
    if (!measureMode) return
    const el = rendererRef.current?.domElement
    const scene = sceneRef.current
    const mount = mountRef.current
    if (!el || !scene || !mount) return

    const overlay = buildMeasureOverlay(measureMarkerRadius())
    scene.add(overlay.group)
    measureOverlayRef.current = overlay

    const badge = document.createElement('div')
    badge.className =
      'pointer-events-none absolute z-20 px-1.5 py-0.5 rounded text-[11px] ' +
      'bg-[var(--bg-elevated,#1e1e28)] text-[var(--text-primary,#fff)] shadow'
    badge.style.display = 'none'
    mount.appendChild(badge)
    measureBadgeRef.current = badge

    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let downX = 0, downY = 0
    const onDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY }

    // Reproject the badge onto the current camera. Runs on every click (new
    // point placed) and on every OrbitControls "change" (orbit/pan/zoom) while
    // both points exist, so the badge tracks the line instead of staying
    // pinned to the screen position it had when placed.
    const reprojectBadge = () => {
      if (!overlay.pointA || !overlay.pointB || !cameraRef.current) return
      const rect = el.getBoundingClientRect()
      const dist = measureDistance(overlay, useViewerStore.getState().geometryDetails?.modelUnitInMm ?? 1)
      if (dist == null) return
      const unit = useViewerStore.getState().measurementUnit
      const mid = overlay.pointA.clone().lerp(overlay.pointB, 0.5).project(cameraRef.current)
      badge.textContent = formatLength(fromMm(dist, unit), unit)
      badge.style.left = `${(mid.x * 0.5 + 0.5) * rect.width}px`
      badge.style.top = `${(-mid.y * 0.5 + 0.5) * rect.height}px`
      badge.style.display = ''
    }

    const onClick = (e: MouseEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 4) return // was a drag
      const rect = el.getBoundingClientRect()
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, cameraRef.current!)
      const p = pickSurfacePoint(withGeometry(modelMeshes()), raycaster)
      if (!p) return
      setMeasurePoint(overlay, p)
      const unitInMm = useViewerStore.getState().geometryDetails?.modelUnitInMm ?? 1
      const dist = measureDistance(overlay, unitInMm)
      useViewerStore.getState().setMeasureDistanceMm(dist)
      if (dist != null && overlay.pointA && overlay.pointB) {
        reprojectBadge()
      } else {
        badge.style.display = 'none'
      }
      invalidate()
    }

    const onControlsChange = () => reprojectBadge()
    controlsRef.current?.addEventListener('change', onControlsChange)

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useViewerStore.getState().setMeasureMode(false)
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('click', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey)
      controlsRef.current?.removeEventListener('change', onControlsChange)
      disposeMeasureOverlay(overlay)
      measureOverlayRef.current = null
      badge.remove()
      measureBadgeRef.current = null
      useViewerStore.getState().setMeasureDistanceMm(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureMode, rendererGen])

  // Effect 10c: Auto-disarm measure when the Repair dialog opens
  useEffect(() => {
    if (repairDialogOpen && measureMode) useViewerStore.getState().setMeasureMode(false)
  }, [repairDialogOpen, measureMode])

  // Effect 10d/10e: Measure mode and hole-fill mode are mutually exclusive —
  // arming one disarms the other so a single click cannot both fill a hole
  // and place a measure point on the same canvas listener stack. Each effect
  // depends only on the flag that is turning on, not the pair, so enabling
  // one while the other is already on triggers exactly one disarm instead of
  // both effects racing to switch each other off in the same commit.
  useEffect(() => {
    if (measureMode) useViewerStore.getState().setHoleFillMode(false)
  }, [measureMode])
  useEffect(() => {
    if (holeFillMode) useViewerStore.getState().setMeasureMode(false)
  }, [holeFillMode])

  // Effect 11: Split-by-shell part visibility — sync store flags onto the live
  // part meshes. Keyed on the store array the SplitPanel toggles.
  const splitParts = useViewerStore((s) => s.splitParts)
  useEffect(() => {
    let changed = false
    for (const p of splitParts) {
      const m = splitPartsRef.current.get(p.id)
      if (m && m.visible !== p.visible) { m.visible = p.visible; changed = true }
    }
    if (changed) invalidate()
  }, [splitParts])

  return <div ref={mountRef} className="w-full h-full relative" />
  }
)
