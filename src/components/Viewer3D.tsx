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
}

interface Viewer3DProps {
  filePath: string | null
  fileExtension: string | null
  viewMode: 'solid' | 'wireframe' | 'points'
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
  // Version counter for multi-model effect to detect stale promise resolutions
  const effectVersionRef = useRef(0)
  // Version counter for the single-model preview effect (Effect 2) so a
  // resolution from a superseded or cleared load can be detected and disposed
  const previewVersionRef = useRef(0)
  const gridRef = useRef<THREE.GridHelper | undefined>(undefined)
  const lightsRef = useRef<THREE.Light[]>([])
  const antialiasRef = useRef(true) // matches initial renderer creation
  const animIdRef = useRef<number>(0)
  const animRef = useRef<CameraAnimationState>(createAnimationState())

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
          '3D view unavailable: WebGL2 could not be initialized. Enable hardware acceleration in your browser (chrome://gpu shows the status; on Chrome you may need chrome://flags to allow WebGL2 for your GPU) and reload.'
        )
      return
    }
    renderer.setPixelRatio(window.devicePixelRatio)
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

    // Store refs
    sceneRef.current = scene
    rendererRef.current = renderer
    cameraRef.current = camera
    controlsRef.current = controls

    // Animation loop — uses refs so renderer/controls recreation in Effect 7 is picked up
    const animate = () => {
      animIdRef.current = requestAnimationFrame(animate)
      tickCameraAnimation(animRef.current, cameraRef.current!, controlsRef.current!)
      controlsRef.current?.update()
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current)
      }
    }
    animate()

    return () => {
      renderer.domElement.removeEventListener('dblclick', onDblClick)
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
    clearModels()

    // Dispose previous preview model if any
    if (modelGroupRef.current) {
      disposeModel(modelGroupRef.current, scene)
      modelGroupRef.current = undefined
    }

    // Browser-supplied files (drag-and-drop / file input) carry their bytes
    // in the store; native files are read by path over Tauri IPC
    const loadPromise = fileBuffer
      ? loadModelFromBuffer(fileBuffer, fileExtension, scene, cameraRef.current)
      : loadModel(filePath, fileExtension, scene, cameraRef.current)

    loadPromise
      .then((obj) => {
        if (previewVersionRef.current !== version) {
          // Stale resolution — a newer load started or the preview was cleared
          disposeModel(obj, scene)
          return
        }
        modelGroupRef.current = obj
        setTriangleCount(countTriangles(obj))
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
        if (previewVersionRef.current === version) setLoading(false)
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
  useEffect(() => {
    if (!sceneRef.current || !cameraRef.current || !controlsRef.current) return

    const version = ++effectVersionRef.current
    const scene = sceneRef.current
    const camera = cameraRef.current

    const currentIds = new Set(modelMapRef.current.keys())
    const nextIds = new Set(loadedModels.map((m) => m.id))

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
        const promise = loadModel(model.path, model.extension, scene, camera, { center: false })
          .then((obj) => {
            // The model may have been removed (or the scene cleared by the
            // single-file preview path) while the load was in flight —
            // committing it would orphan the mesh in the scene forever
            const stillLoaded = useViewerStore
              .getState()
              .loadedModels.some((m) => m.id === model.id)
            if (!stillLoaded) {
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
          })
        addPromises.push(promise)
      }
    }

    // After all adds complete, fit camera to all multi-model objects
    // Skip if effect version has changed (stale resolution from rapid loadedModels changes)
    Promise.all(addPromises).then(() => {
      if (effectVersionRef.current !== version) return
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
  }, [loadedModels])

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
      const perspCamera = new THREE.PerspectiveCamera(
        75, width / height, 0.1, 10000
      )
      perspCamera.position.copy(currentPos)
      perspCamera.up.copy(currentUp)
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
        controlsRef.current = controls
      }

      // Re-attach double-click handler
      const raycaster = new THREE.Raycaster()
      const mouse = new THREE.Vector2()
      newRenderer.domElement.addEventListener('dblclick', (e: MouseEvent) => {
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
      })

      rendererRef.current = newRenderer
      antialiasRef.current = settings.antialias

      // Skip remaining in-place updates since we just configured the new renderer
      return
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
