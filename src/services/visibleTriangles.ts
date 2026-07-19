import * as THREE from 'three'

/**
 * 42 roughly uniform view directions (subdivided icosahedron vertices).
 * Exported for tests.
 */
export function viewDirections(): THREE.Vector3[] {
  const geometry = new THREE.IcosahedronGeometry(1, 1)
  const position = geometry.getAttribute('position')
  const seen = new Map<string, THREE.Vector3>()
  for (let index = 0; index < position.count; index++) {
    const direction = new THREE.Vector3().fromBufferAttribute(position, index).normalize()
    const key = `${direction.x.toFixed(5)},${direction.y.toFixed(5)},${direction.z.toFixed(5)}`
    if (!seen.has(key)) seen.set(key, direction)
  }
  geometry.dispose()
  return [...seen.values()]
}

/**
 * Mark every triangle of the soup that is visible from outside the model:
 * the soup is rendered from 42 surrounding directions with each triangle's
 * id encoded as a flat vertex color, and ids that appear in any view are
 * flagged. This protects geometry the voxel air-flood misclassifies —
 * surfaces behind gaps narrower than a voxel are still visible to the eye
 * and must survive Make solid. Returns null when WebGL is unavailable.
 */
export function visibleTriangleFlags(
  positions: Float32Array,
  progress: (fraction: number) => void = () => {}
): Uint8Array | null {
  const triangles = Math.floor(positions.length / 9)
  if (triangles === 0) return new Uint8Array(0)
  let renderer: THREE.WebGLRenderer | null = null
  try {
    renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false })
  } catch {
    return null
  }
  const flags = new Uint8Array(triangles)
  const geometry = new THREE.BufferGeometry()
  const target = new THREE.WebGLRenderTarget(1024, 1024)
  let material: THREE.MeshBasicMaterial | null = null
  try {
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    // Encode id+1 into rgb bytes; 0 stays the background clear color.
    const ids = new Uint8Array(triangles * 9)
    for (let triangle = 0; triangle < triangles; triangle++) {
      const value = triangle + 1
      for (let corner = 0; corner < 3; corner++) {
        const at = (triangle * 3 + corner) * 3
        ids[at] = value & 0xff
        ids[at + 1] = (value >> 8) & 0xff
        ids[at + 2] = (value >> 16) & 0xff
      }
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(ids, 3, true))
    material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false })
    const mesh = new THREE.Mesh(geometry, material)
    const scene = new THREE.Scene()
    scene.add(mesh)

    geometry.computeBoundingSphere()
    const sphere = geometry.boundingSphere!
    const radius = Math.max(sphere.radius, 1e-6)
    const camera = new THREE.OrthographicCamera(-radius * 1.05, radius * 1.05, radius * 1.05, -radius * 1.05, radius * 0.5, radius * 4)
    renderer.setClearColor(0x000000, 1)
    renderer.setRenderTarget(target)
    const pixels = new Uint8Array(target.width * target.height * 4)
    const directions = viewDirections()
    directions.forEach((direction, view) => {
      camera.position.copy(sphere.center).addScaledVector(direction, radius * 2)
      camera.up.set(Math.abs(direction.y) > 0.9 ? 1 : 0, Math.abs(direction.y) > 0.9 ? 0 : 1, 0)
      camera.lookAt(sphere.center)
      camera.updateProjectionMatrix()
      renderer!.clear()
      renderer!.render(scene, camera)
      renderer!.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels)
      for (let at = 0; at < pixels.length; at += 4) {
        const value = pixels[at] | (pixels[at + 1] << 8) | (pixels[at + 2] << 16)
        if (value > 0 && value <= triangles) flags[value - 1] = 1
      }
      progress((view + 1) / directions.length)
    })
    return flags
  } catch {
    return null
  } finally {
    target.dispose()
    geometry.deleteAttribute('position')
    geometry.dispose()
    material?.dispose()
    renderer.dispose()
  }
}
