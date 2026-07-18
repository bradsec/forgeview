// Three.js r152+: use 'three/addons/' NOT 'three/examples/jsm/'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js'
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js'
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js'
import * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { invoke } from '@tauri-apps/api/core'
import { getBrowserFile } from '../services/browserFs'

export const SUPPORTED_EXTENSIONS = ['.stl', '.3mf', '.obj', '.gltf', '.glb', '.ply', '.dae']

export function getLoaderForExtension(ext: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map: Record<string, any> = {
    '.stl': STLLoader,
    '.3mf': ThreeMFLoader,
    '.obj': OBJLoader,
    '.gltf': GLTFLoader,
    '.glb': GLTFLoader,
    '.ply': PLYLoader,
    '.dae': ColladaLoader,
  }
  const LoaderClass = map[ext.toLowerCase()]
  return LoaderClass ? new LoaderClass() : null
}

// Auto-center and scale model to fit view
export function fitModelToView(object: THREE.Object3D, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera) {
  const box = new THREE.Box3().setFromObject(object)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  if (!Number.isFinite(maxDim) || maxDim <= 0) {
    throw new Error('Model has no renderable geometry')
  }
  // Center horizontally, but place bottom on grid plane (Y=0)
  object.position.set(-center.x, -box.min.y, -center.z)
  camera.position.set(0, maxDim * 0.75, maxDim * 2)
  camera.near = Math.max(0.001, maxDim * 0.01)
  camera.far = Math.min(maxDim * 100, 1e7)
  camera.updateProjectionMatrix()
}

/**
 * Fit camera to encompass the union bounding box of all provided objects.
 * Controls target is set to the center of the union bounding box.
 * No-op for empty array.
 */
export function fitAllModels(
  objects: THREE.Object3D[],
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  controls: OrbitControls
): void {
  if (objects.length === 0) return
  const unionBox = new THREE.Box3()
  for (const obj of objects) {
    obj.updateMatrixWorld(true)
    unionBox.union(new THREE.Box3().setFromObject(obj))
  }
  const center = unionBox.getCenter(new THREE.Vector3())
  const size = unionBox.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  if (!Number.isFinite(maxDim) || maxDim <= 0) {
    throw new Error('Scene has no renderable geometry')
  }
  camera.position.set(center.x, center.y + maxDim * 0.75, center.z + maxDim * 2)
  camera.near = Math.max(0.01, maxDim * 0.01)
  camera.far = Math.min(maxDim * 100, 1e7)
  camera.updateProjectionMatrix()
  controls.target.copy(center)
  controls.update()
}

/**
 * Parse raw model bytes with the appropriate Three.js loader for the
 * extension. Pure parsing — no Tauri IPC, works in a plain browser.
 */
export async function parseModelBuffer(buffer: ArrayBuffer, ext: string): Promise<THREE.Object3D> {
  const extension = ext.toLowerCase()
  let object: THREE.Object3D

  switch (extension) {
    case '.stl': {
      const geo = new STLLoader().parse(buffer)
      geo.computeVertexNormals()
      object = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xb0b0b0, roughness: 0.45, metalness: 0.1, side: THREE.DoubleSide }))
      break
    }
    case '.ply': {
      const geo = new PLYLoader().parse(buffer)
      geo.computeVertexNormals()
      object = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xb0b0b0, roughness: 0.45, metalness: 0.1, side: THREE.DoubleSide }))
      break
    }
    case '.3mf': {
      object = new ThreeMFLoader().parse(buffer) as THREE.Group
      break
    }
    case '.obj': {
      const text = new TextDecoder().decode(buffer)
      object = new OBJLoader().parse(text)
      break
    }
    case '.dae': {
      const text = new TextDecoder().decode(buffer)
      const result = new ColladaLoader().parse(text, '')
      if (!result) throw new Error('ColladaLoader failed to parse file')
      object = result.scene
      break
    }
    case '.gltf':
    case '.glb': {
      const gltf = await new GLTFLoader().parseAsync(buffer, '')
      object = gltf.scene
      break
    }
    default:
      throw new Error(`Unsupported format: ${ext}`)
  }

  return object
}

/**
 * Parse an in-memory model buffer, auto-center it, and add it to the scene.
 * Browser entry point (drag-and-drop / file input) — no Tauri required.
 * Pass options.center=false to skip fitModelToView (for multi-model add-to-scene).
 */
export async function loadModelFromBuffer(
  buffer: ArrayBuffer,
  ext: string,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  options?: { center?: boolean }
): Promise<THREE.Object3D> {
  const object = await parseModelBuffer(buffer, ext)
  try {
    if (options?.center !== false) {
      fitModelToView(object, camera)
    }
  } catch (error) {
    disposeModel(object, scene)
    throw error
  }
  // Multi-model path (center=false): preserve original coordinates
  // so assembly parts keep their relative positions
  scene.add(object)
  return object
}

/**
 * Load a 3D model from a file path, then parse, auto-center, and add it to
 * the scene. Virtual paths from a browser-picked folder resolve in memory;
 * anything else reads bytes via Tauri IPC.
 */
export async function loadModel(
  path: string,
  ext: string,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  options?: { center?: boolean }
): Promise<THREE.Object3D> {
  const browserFile = getBrowserFile(path)
  if (browserFile) {
    return loadModelFromBuffer(await browserFile.arrayBuffer(), ext, scene, camera, options)
  }
  // read_file_bytes returns a raw binary payload (tauri::ipc::Response),
  // which arrives as an ArrayBuffer on the JS side.
  const buffer: ArrayBuffer = await invoke('read_file_bytes', { path })
  return loadModelFromBuffer(buffer, ext, scene, camera, options)
}

/**
 * Dispose a model from the scene, freeing all GPU resources.
 * Traverses the object tree disposing geometry, materials, and textures.
 */
export function disposeModel(object: THREE.Object3D, scene: THREE.Scene): void {
  // Clean up any Points companions created by applyViewMode('points')
  const companions = object.userData.pointsCompanions as THREE.Points[] | undefined
  if (companions) {
    for (const pts of companions) {
      pts.geometry.dispose()
      if (pts.material instanceof THREE.PointsMaterial) pts.material.dispose()
      if (pts.parent) pts.parent.remove(pts)
    }
    object.userData.pointsCompanions = undefined
  }

  scene.remove(object)

  object.traverse((child) => {
    const renderable =
      child instanceof THREE.Mesh ||
      child instanceof THREE.Line ||
      child instanceof THREE.LineSegments ||
      child instanceof THREE.Points
    if (renderable) {
      const r = child as THREE.Mesh
      // Dispose geometry
      if (r.geometry) {
        r.geometry.dispose()
      }

      // Dispose materials (handle single and array)
      const materials = Array.isArray(r.material) ? r.material : [r.material]
      for (const mat of materials) {
        if (!mat) continue

        // Dispose textures from known material properties
        const texProperties = [
          'map',
          'lightMap',
          'bumpMap',
          'normalMap',
          'specularMap',
          'envMap',
          'alphaMap',
          'aoMap',
          'displacementMap',
          'metalnessMap',
          'roughnessMap',
          'emissiveMap',
        ] as const

        for (const prop of texProperties) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tex = (mat as any)[prop] as THREE.Texture | undefined
          if (tex && tex.dispose) {
            tex.dispose()
          }
        }

        mat.dispose()
      }
    }
  })
}

/**
 * Apply a view mode to a model object tree.
 * - 'solid': standard shaded rendering
 * - 'wireframe': wireframe overlay
 * - 'points': point cloud representation
 */
export function applyViewMode(
  root: THREE.Object3D,
  mode: 'solid' | 'wireframe' | 'points'
): void {
  // Remove any existing Points companions (tracked explicitly on root.userData
  // because traverse won't find them if they were added to the scene as siblings)
  const companions = root.userData.pointsCompanions as THREE.Points[] | undefined
  if (companions) {
    for (const pts of companions) {
      pts.geometry.dispose()
      if (pts.material instanceof THREE.PointsMaterial) pts.material.dispose()
      if (pts.parent) pts.parent.remove(pts)
    }
  }
  root.userData.pointsCompanions = []

  // Apply the mode to all meshes
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const materials = Array.isArray(child.material) ? child.material : [child.material]

      if (mode === 'solid') {
        for (const mat of materials) {
          if (mat) mat.wireframe = false
        }
        child.visible = true
      } else if (mode === 'wireframe') {
        for (const mat of materials) {
          if (mat) mat.wireframe = true
        }
        child.visible = true
      } else if (mode === 'points') {
        for (const mat of materials) {
          if (mat) mat.wireframe = false
        }
        child.visible = false

        const points = new THREE.Points(
          pointCloudGeometry(child.geometry),
          new THREE.PointsMaterial({
            color: 0xc56a45,
            size: 2,
            sizeAttenuation: false,
            transparent: true,
            opacity: 0.9,
          })
        )
        points.position.copy(child.position)
        points.rotation.copy(child.rotation)
        points.scale.copy(child.scale)

        // Add to parent (may be the scene for single-mesh models like STL)
        const target = child.parent || root
        target.add(points)
        ;(root.userData.pointsCompanions as THREE.Points[]).push(points)
      }
    }
  })
}

/** Build one point per used vertex, welding duplicated STL triangle corners. */
function pointCloudGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = source.getAttribute('position')
  const bounds = new THREE.Box3()
  const point = new THREE.Vector3()
  for (let index = 0; index < position.count; index++) {
    point.set(position.getX(index), position.getY(index), position.getZ(index))
    bounds.expandByPoint(point)
  }
  const scale = bounds.getSize(new THREE.Vector3()).length()
  const tolerance = Math.max(scale * 1e-7, 1e-9)
  const unique = new Map<string, [number, number, number]>()
  const add = (index: number) => {
    const x = position.getX(index)
    const y = position.getY(index)
    const z = position.getZ(index)
    const key = `${Math.round(x / tolerance)},${Math.round(y / tolerance)},${Math.round(z / tolerance)}`
    if (!unique.has(key)) unique.set(key, [x, y, z])
  }

  if (source.index) {
    for (let index = 0; index < source.index.count; index++) add(source.index.getX(index))
  } else {
    for (let index = 0; index < position.count; index++) add(index)
  }

  const values = new Float32Array(unique.size * 3)
  let offset = 0
  for (const vertex of unique.values()) {
    values[offset++] = vertex[0]
    values[offset++] = vertex[1]
    values[offset++] = vertex[2]
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(values, 3))
  return geometry
}

/**
 * Count total triangles in an object tree.
 * Uses index.count / 3 for indexed geometry, position.count / 3 otherwise.
 */
export function countTriangles(object: THREE.Object3D): number {
  let count = 0

  object.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const geo = child.geometry
      if (geo.index !== null) {
        count += geo.index.count / 3
      } else if (geo.attributes.position?.count) {
        count += geo.attributes.position.count / 3
      }
    }
  })

  return Math.round(count)
}
