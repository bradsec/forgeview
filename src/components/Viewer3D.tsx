import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
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
import { analyzeGeometry } from '../services/makeSolid'
import { repairGeometriesInWorker, type SolidRepairStats } from '../services/solidRepair'

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
  makeSolid: (resolution: number, onProgress: (percent: number, phase: string) => void, signal?: AbortSignal) => Promise<SolidRepairStats>
  getModelDimensions: () => THREE.Vector3 | null
  undoEdit: () => void
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
  // Track in-flight model loads to prevent duplicate loading from effect re-runs
  const loadingIdsRef = useRef<Set<string>>(new Set())
  // Version counter for the single-model preview effect (Effect 2) so a
  // resolution from a superseded or cleared load can be detected and disposed
  const previewVersionRef = useRef(0)
  const gridRef = useRef<THREE.GridHelper | undefined>(undefined)
  const lightsRef = useRef<THREE.Light[]>([])
  const antialiasRef = useRef(true) // matches initial renderer creation
  const animIdRef = useRef<number>(0)
  const animRef = useRef<CameraAnimationState>(createAnimationState())
  // Current double-click listener and its element, so renderer swaps
  // (Effect 7) and unmount can detach the live listener
  const dblClickRef = useRef<{ el: HTMLElement; fn: (e: MouseEvent) => void } | null>(null)
  // Demand rendering: frames left to draw. The loop skips renderer.render when
  // 0 and no camera motion — keeps the GPU idle (software/weak GPUs stay
  // responsive). Bumped by controls changes, resizes, and any store change
  // (model loads, view mode, theme, settings all land in the store). A small
  // budget instead of a boolean absorbs mutations that land mid-frame.
  const framesToRenderRef = useRef(3)
  const undoRef = useRef<{ apply: () => void; discard: () => void } | null>(null)
  const invalidate = () => { framesToRenderRef.current = 3 }

  const modelRoots = () => [modelGroupRef.current, ...modelMapRef.current.values()].filter((root): root is THREE.Object3D => Boolean(root))
  const modelMeshes = () => {
    const meshes: THREE.Mesh[] = []
    for (const root of modelRoots()) root.traverse((child) => { if (child instanceof THREE.Mesh) meshes.push(child) })
    return meshes
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
    const health = meshes.map((mesh) => analyzeGeometry(mesh.geometry)).reduce((sum, item) => ({
      vertices: sum.vertices + item.vertices,
      boundaryEdges: sum.boundaryEdges + item.boundaryEdges,
      nonManifoldEdges: sum.nonManifoldEdges + item.nonManifoldEdges,
      watertight: sum.watertight && item.watertight,
    }), { vertices: 0, boundaryEdges: 0, nonManifoldEdges: 0, watertight: true })
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
  const clearUndo = () => {
    undoRef.current?.discard()
    undoRef.current = null
    useViewerStore.getState().setCanUndoEdit(false)
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
    makeSolid: async (resolution, onProgress, signal) => {
      const meshes = modelMeshes()
      const result = await repairGeometriesInWorker(meshes, resolution, onProgress, signal)
      const currentMeshes = modelMeshes()
      if (currentMeshes.length !== meshes.length || meshes.some((mesh, index) => mesh !== currentMeshes[index])) {
        result.geometries.forEach((geometry) => geometry.dispose())
        throw new Error('The open model changed while repair was running')
      }
      clearUndo()
      const originals = meshes.map((mesh) => mesh.geometry)
      const originalMaterial = meshes[0].material
      meshes.forEach((mesh, index) => { mesh.geometry = result.geometries[index] })
      // The filled solid is one STL-style geometry without uv/color attributes;
      // the source material (possibly textured) would render it broken.
      const solidMaterial = new THREE.MeshStandardMaterial({
        color: getTheme(useViewerStore.getState().theme).modelColor,
        roughness: 0.85,
        metalness: 0,
      })
      meshes[0].material = solidMaterial
      undoRef.current = {
        apply: () => {
          meshes.forEach((mesh, index) => { mesh.geometry.dispose(); mesh.geometry = originals[index] })
          meshes[0].material = originalMaterial
          solidMaterial.dispose()
        },
        discard: () => {
          originals.forEach((geometry) => geometry.dispose())
          for (const material of Array.isArray(originalMaterial) ? originalMaterial : [originalMaterial]) material.dispose()
        },
      }
      useViewerStore.getState().setCanUndoEdit(true)
      const roots = modelRoots()
      for (const root of roots) applyViewMode(root, useViewerStore.getState().viewMode)
      updateTriangleDetails()
      updateGeometryDetails()
      invalidate()
      return result.stats
    },
    undoEdit: () => {
      const undo = undoRef.current
      undoRef.current = null
      undo?.apply()
      useViewerStore.getState().setCanUndoEdit(false)
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
    clearUndo()

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
    if (currentIds.size !== nextIds.size || [...currentIds].some((id) => !nextIds.has(id))) clearUndo()

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

      rendererRef.current = newRenderer
      antialiasRef.current = settings.antialias

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
  }, [theme])

  return <div ref={mountRef} className="w-full h-full" />
  }
)
