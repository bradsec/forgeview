import { useEffect, useRef, useCallback } from 'react'
import * as THREE from 'three'
import type { ViewDirection } from '../utils/cameraActions'

interface ViewCubeProps {
  /** Called when user clicks a face */
  onSnapToView: (direction: ViewDirection) => void
  /** Called when user drags the cube to orbit the main camera */
  onOrbitBy: (deltaTheta: number, deltaPhi: number) => void
  /** Provide the main camera so cube can sync orientation */
  getCamera: () => THREE.PerspectiveCamera | THREE.OrthographicCamera | undefined
}

const FACE_COLORS: Record<ViewDirection, number> = {
  front:  0x4a6fa5,
  back:   0x4a6fa5,
  top:    0x5a8a5a,
  bottom: 0x5a8a5a,
  left:   0xa55a5a,
  right:  0xa55a5a,
}

const FACE_LABELS: { direction: ViewDirection; label: string; position: THREE.Vector3; rotation: THREE.Euler }[] = [
  { direction: 'front',  label: 'F',  position: new THREE.Vector3(0, 0, 0.51),   rotation: new THREE.Euler(0, 0, 0) },
  { direction: 'back',   label: 'Bk', position: new THREE.Vector3(0, 0, -0.51),  rotation: new THREE.Euler(0, Math.PI, 0) },
  { direction: 'top',    label: 'T',  position: new THREE.Vector3(0, 0.51, 0),   rotation: new THREE.Euler(-Math.PI / 2, 0, 0) },
  { direction: 'bottom', label: 'Bo', position: new THREE.Vector3(0, -0.51, 0),  rotation: new THREE.Euler(Math.PI / 2, 0, 0) },
  { direction: 'left',   label: 'L',  position: new THREE.Vector3(-0.51, 0, 0),  rotation: new THREE.Euler(0, -Math.PI / 2, 0) },
  { direction: 'right',  label: 'R',  position: new THREE.Vector3(0.51, 0, 0),   rotation: new THREE.Euler(0, Math.PI / 2, 0) },
]

/** Pixels of movement before a mousedown is treated as drag instead of click */
const DRAG_THRESHOLD = 4
/** Sensitivity: radians per pixel of mouse movement */
const ORBIT_SENSITIVITY = 0.01

function createFaceTexture(label: string, color: number): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  // Background
  const hex = '#' + color.toString(16).padStart(6, '0')
  ctx.fillStyle = hex
  ctx.fillRect(0, 0, size, size)

  // Border
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'
  ctx.lineWidth = 3
  ctx.strokeRect(1, 1, size - 2, size - 2)

  // Label
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.font = 'bold 48px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, size / 2, size / 2)

  return new THREE.CanvasTexture(canvas)
}

export function ViewCube({ onSnapToView, onOrbitBy, getCamera }: ViewCubeProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const cubeSceneRef = useRef<THREE.Scene | undefined>(undefined)
  const cubeCameraRef = useRef<THREE.PerspectiveCamera | undefined>(undefined)
  const cubeRendererRef = useRef<THREE.WebGLRenderer | undefined>(undefined)
  const cubeRef = useRef<THREE.Group | undefined>(undefined)
  const animIdRef = useRef<number>(0)
  const faceMeshesRef = useRef<Map<THREE.Mesh, ViewDirection>>(new Map())

  // Drag state — stored in refs so event handlers don't need re-binding
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const isDraggingRef = useRef(false)

  // Keep the latest getCamera in a ref so the setup effect can read it without
  // depending on its identity. Otherwise a new getCamera each parent render
  // would tear down and rebuild the whole WebGL scene (renderer, textures).
  const getCameraRef = useRef(getCamera)
  getCameraRef.current = getCamera

  // Setup mini scene — runs once; reads getCamera via ref
  useEffect(() => {
    if (cubeRendererRef.current) return
    if (!mountRef.current) return

    const container = mountRef.current
    const size = 80

    const scene = new THREE.Scene()
    scene.background = null // transparent

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
    camera.position.set(0, 0, 3.5)

    // Without WebGL the main viewer already surfaces an error banner;
    // the view cube just stays absent
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      return
    }
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(size, size)
    renderer.setClearColor(0x000000, 0)
    container.appendChild(renderer.domElement)

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.8))
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5)
    dirLight.position.set(2, 3, 4)
    scene.add(dirLight)

    // Build cube from 6 face planes
    const group = new THREE.Group()
    const faceMap = new Map<THREE.Mesh, ViewDirection>()
    const disposables: { textures: THREE.CanvasTexture[], geometries: THREE.PlaneGeometry[], materials: THREE.MeshBasicMaterial[] } = { textures: [], geometries: [], materials: [] }

    for (const face of FACE_LABELS) {
      const texture = createFaceTexture(face.label, FACE_COLORS[face.direction])
      const material = new THREE.MeshBasicMaterial({ map: texture })
      const geometry = new THREE.PlaneGeometry(1, 1)
      disposables.textures.push(texture)
      disposables.geometries.push(geometry)
      disposables.materials.push(material)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.copy(face.position)
      mesh.rotation.copy(face.rotation)
      group.add(mesh)
      faceMap.set(mesh, face.direction)
    }

    scene.add(group)

    cubeSceneRef.current = scene
    cubeCameraRef.current = camera
    cubeRendererRef.current = renderer
    cubeRef.current = group
    faceMeshesRef.current = faceMap

    // Animation — sync cube rotation with main camera. Only re-render when
    // the orientation actually changed; identical quaternions mean the frame
    // is already correct and the GPU can stay idle.
    const lastQ = new THREE.Quaternion(NaN, NaN, NaN, NaN)
    const animate = () => {
      animIdRef.current = requestAnimationFrame(animate)
      const mainCamera = getCameraRef.current()
      if (mainCamera && group) {
        const q = mainCamera.quaternion.clone().invert()
        if (!q.equals(lastQ)) {
          lastQ.copy(q)
          group.quaternion.copy(q)
          renderer.render(scene, camera)
        }
      }
    }
    animate()

    return () => {
      cancelAnimationFrame(animIdRef.current)
      disposables.textures.forEach(t => t.dispose())
      disposables.geometries.forEach(g => g.dispose())
      disposables.materials.forEach(m => m.dispose())
      renderer.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
      cubeRendererRef.current = undefined
    }
  }, [])

  // Mousedown — start potential drag or click
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return // left button only
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    isDraggingRef.current = false
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  // Mousemove — if past threshold, treat as drag and orbit camera
  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return

    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y

    if (!isDraggingRef.current) {
      if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return
      isDraggingRef.current = true
    }

    // Orbit the main camera based on mouse delta
    onOrbitBy(dx * ORBIT_SENSITIVITY, dy * ORBIT_SENSITIVITY)
    dragStartRef.current = { x: e.clientX, y: e.clientY }
  }, [onOrbitBy])

  // Mouseup — if it was a click (not a drag), do face raycast
  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const wasDragging = isDraggingRef.current
    dragStartRef.current = null
    isDraggingRef.current = false

    if (wasDragging) return // was a drag, not a click

    // Treat as click — raycast to determine which face
    if (!cubeRendererRef.current || !cubeCameraRef.current || !cubeRef.current) return

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )

    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, cubeCameraRef.current)

    const meshes = Array.from(faceMeshesRef.current.keys())
    const hits = raycaster.intersectObjects(meshes)
    if (hits.length > 0) {
      const direction = faceMeshesRef.current.get(hits[0].object as THREE.Mesh)
      if (direction) {
        onSnapToView(direction)
      }
    }
  }, [onSnapToView])

  return (
    <div
      ref={mountRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className="w-20 h-20 cursor-grab active:cursor-grabbing"
      title="Click a face to snap view, or drag to orbit"
    />
  )
}
