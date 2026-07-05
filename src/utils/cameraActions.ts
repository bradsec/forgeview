import * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export type ViewDirection = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right'

/** Target positions for each standard view, at distance `d` from origin */
const VIEW_OFFSETS: Record<ViewDirection, THREE.Vector3> = {
  front:  new THREE.Vector3(0, 0, 1),
  back:   new THREE.Vector3(0, 0, -1),
  top:    new THREE.Vector3(0, 1, 0),
  bottom: new THREE.Vector3(0, -1, 0),
  left:   new THREE.Vector3(-1, 0, 0),
  right:  new THREE.Vector3(1, 0, 0),
}

const VIEW_UPS: Record<ViewDirection, THREE.Vector3> = {
  front:  new THREE.Vector3(0, 1, 0),
  back:   new THREE.Vector3(0, 1, 0),
  top:    new THREE.Vector3(0, 0, -1),
  bottom: new THREE.Vector3(0, 0, 1),
  left:   new THREE.Vector3(0, 1, 0),
  right:  new THREE.Vector3(0, 1, 0),
}

export interface CameraAnimationState {
  active: boolean
  startTime: number
  duration: number
  startPos: THREE.Vector3
  endPos: THREE.Vector3
  startUp: THREE.Vector3
  endUp: THREE.Vector3
  startTarget: THREE.Vector3
  endTarget: THREE.Vector3
  /** For orthographic camera zoom interpolation */
  startZoom: number
  endZoom: number
}

/** Create initial (inactive) animation state */
export function createAnimationState(): CameraAnimationState {
  return {
    active: false,
    startTime: 0,
    duration: 300,
    startPos: new THREE.Vector3(),
    endPos: new THREE.Vector3(),
    startUp: new THREE.Vector3(0, 1, 0),
    endUp: new THREE.Vector3(0, 1, 0),
    startTarget: new THREE.Vector3(),
    endTarget: new THREE.Vector3(),
    startZoom: 1,
    endZoom: 1,
  }
}

/** Ease-in-out cubic */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * Tween duration in ms. Collapses to ~instant when the user prefers reduced
 * motion (1ms rather than 0 to avoid a divide-by-zero in the progress calc).
 */
function tweenDurationMs(): number {
  const reduce =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return reduce ? 1 : 300
}

/**
 * Tick the camera animation. Call this every frame from the animation loop.
 * Returns true if animation is still active.
 */
export function tickCameraAnimation(
  anim: CameraAnimationState,
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  controls: OrbitControls
): boolean {
  if (!anim.active) return false

  const elapsed = performance.now() - anim.startTime
  const rawT = Math.min(elapsed / anim.duration, 1)
  const t = easeInOutCubic(rawT)

  camera.position.lerpVectors(anim.startPos, anim.endPos, t)
  camera.up.lerpVectors(anim.startUp, anim.endUp, t).normalize()
  controls.target.lerpVectors(anim.startTarget, anim.endTarget, t)

  // Interpolate orthographic zoom
  if (camera instanceof THREE.OrthographicCamera && anim.startZoom !== anim.endZoom) {
    camera.zoom = anim.startZoom + (anim.endZoom - anim.startZoom) * t
    camera.updateProjectionMatrix()
  }

  controls.update()

  if (rawT >= 1) {
    anim.active = false
  }

  return anim.active
}

/**
 * Compute the bounding sphere distance for current scene objects.
 * Returns a reasonable default if no objects exist.
 */
function getSceneDistance(scene: THREE.Scene): { center: THREE.Vector3; distance: number } {
  const box = new THREE.Box3()
  let hasContent = false

  scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.updateMatrixWorld(true)
      box.expandByObject(child)
      hasContent = true
    }
  })

  if (!hasContent) {
    return { center: new THREE.Vector3(), distance: 100 }
  }

  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  return { center, distance: maxDim * 2 }
}

/**
 * Compute the orthographic zoom level needed to fit a scene of the given
 * bounding distance into the camera's current frustum.
 */
function orthoZoomForDistance(
  camera: THREE.OrthographicCamera,
  distance: number
): number {
  const frustumHeight = (camera.top - camera.bottom) / camera.zoom
  return frustumHeight / (distance * 1.1) // 1.1 = small margin
}

/** Start an animated snap to a standard view direction */
export function snapToView(
  direction: ViewDirection,
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  controls: OrbitControls,
  scene: THREE.Scene,
  anim: CameraAnimationState
): void {
  const { center, distance } = getSceneDistance(scene)
  const offset = VIEW_OFFSETS[direction].clone().multiplyScalar(distance)

  anim.startPos.copy(camera.position)
  anim.endPos.copy(center).add(offset)
  anim.startUp.copy(camera.up)
  anim.endUp.copy(VIEW_UPS[direction])
  anim.startTarget.copy(controls.target)
  anim.endTarget.copy(center)
  anim.startTime = performance.now()
  anim.duration = tweenDurationMs()

  if (camera instanceof THREE.OrthographicCamera) {
    anim.startZoom = camera.zoom
    anim.endZoom = orthoZoomForDistance(camera, distance)
  } else {
    anim.startZoom = 1
    anim.endZoom = 1
  }

  anim.active = true
}

/** Fit camera to all mesh objects in the scene */
export function fitAll(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  controls: OrbitControls,
  scene: THREE.Scene,
  anim: CameraAnimationState
): void {
  const { center, distance } = getSceneDistance(scene)

  // Keep current view direction, just adjust distance
  const direction = new THREE.Vector3()
    .subVectors(camera.position, controls.target)
    .normalize()

  anim.startPos.copy(camera.position)
  anim.endPos.copy(center).addScaledVector(direction, distance)
  anim.startUp.copy(camera.up)
  anim.endUp.copy(camera.up)
  anim.startTarget.copy(controls.target)
  anim.endTarget.copy(center)
  anim.startTime = performance.now()
  anim.duration = tweenDurationMs()

  if (camera instanceof THREE.OrthographicCamera) {
    anim.startZoom = camera.zoom
    anim.endZoom = orthoZoomForDistance(camera, distance)
  } else {
    anim.startZoom = 1
    anim.endZoom = 1
  }

  anim.active = true
}

/** Reset camera to default position */
export function resetCamera(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  controls: OrbitControls,
  scene: THREE.Scene,
  anim: CameraAnimationState
): void {
  const { center, distance } = getSceneDistance(scene)

  anim.startPos.copy(camera.position)
  anim.endPos.set(center.x, center.y + distance * 0.375, center.z + distance)
  anim.startUp.copy(camera.up)
  anim.endUp.set(0, 1, 0)
  anim.startTarget.copy(controls.target)
  anim.endTarget.copy(center)
  anim.startTime = performance.now()
  anim.duration = tweenDurationMs()

  if (camera instanceof THREE.OrthographicCamera) {
    anim.startZoom = camera.zoom
    anim.endZoom = orthoZoomForDistance(camera, distance)
  } else {
    anim.startZoom = 1
    anim.endZoom = 1
  }

  anim.active = true
}

/** Zoom in/out by a fixed factor along the current view direction */
export function zoomStep(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  controls: OrbitControls,
  factor: number // < 1 = zoom in, > 1 = zoom out
): void {
  if (camera instanceof THREE.OrthographicCamera) {
    // For orthographic: adjust zoom level (inverse of factor since
    // higher zoom = closer view, but factor < 1 means "zoom in")
    camera.zoom /= factor
    camera.updateProjectionMatrix()
    controls.update()
  } else {
    // For perspective: move camera along view direction
    const direction = new THREE.Vector3().subVectors(camera.position, controls.target)
    direction.multiplyScalar(factor)
    camera.position.copy(controls.target).add(direction)
    controls.update()
  }
}
