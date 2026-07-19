import * as THREE from 'three'

/**
 * Bake each mesh's surface color into one rgb byte triple per triangle
 * corner, in the same corner order combinedPositions emits. Sources, in
 * priority order: an existing vertex color attribute, the base-color texture
 * sampled at the corner's uv, or the material's flat color. This is what
 * lets Make solid collapse to a single material without textured or colored
 * surfaces going flat gray. Bytes are sRGB.
 */
export function bakeCornerColors(meshes: THREE.Mesh[]): Uint8Array | null {
  const worthBaking = meshes.some((mesh) => {
    const geometry = mesh.geometry as THREE.BufferGeometry
    if (geometry.hasAttribute('color')) return true
    return materialsOf(mesh).some((material) => textureImage(material) !== null || flatColor(material) !== 0xffffff)
  })
  if (!worthBaking) return null

  const chunks: Uint8Array[] = []
  const samplers = new Map<string, TextureSampler | null>()
  for (const mesh of meshes) {
    const geometry = mesh.geometry as THREE.BufferGeometry
    const index = geometry.index
    const position = geometry.getAttribute('position')
    const corners = index ? index.count : position.count
    const bytes = new Uint8Array(corners * 3)
    const colorAttribute = geometry.hasAttribute('color') ? geometry.getAttribute('color') : null
    const uvAttribute = geometry.hasAttribute('uv') ? geometry.getAttribute('uv') : null
    const materials = materialsOf(mesh)
    for (let corner = 0; corner < corners; corner++) {
      const vertex = index ? index.getX(corner) : corner
      const material = materials[materialIndexAt(geometry, corner)] ?? materials[0]
      let r = 255
      let g = 255
      let b = 255
      if (colorAttribute) {
        // Vertex colors are linear in three; convert back to sRGB bytes.
        const linear = new THREE.Color(colorAttribute.getX(vertex), colorAttribute.getY(vertex), colorAttribute.getZ(vertex))
        const srgb = linear.convertLinearToSRGB()
        r = Math.round(srgb.r * 255); g = Math.round(srgb.g * 255); b = Math.round(srgb.b * 255)
      } else {
        const sampler = samplerFor(material, samplers)
        if (sampler && uvAttribute) {
          ;[r, g, b] = sampler(uvAttribute.getX(vertex), uvAttribute.getY(vertex))
        } else if (material) {
          const hex = flatColor(material)
          r = (hex >> 16) & 0xff; g = (hex >> 8) & 0xff; b = hex & 0xff
        }
      }
      bytes[corner * 3] = r
      bytes[corner * 3 + 1] = g
      bytes[corner * 3 + 2] = b
    }
    chunks.push(bytes)
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

type TextureSampler = (u: number, v: number) => [number, number, number]

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

function materialIndexAt(geometry: THREE.BufferGeometry, corner: number): number {
  if (geometry.groups.length === 0) return 0
  const group = geometry.groups.find((candidate) => corner >= candidate.start && corner < candidate.start + candidate.count)
  return group?.materialIndex ?? 0
}

function flatColor(material: THREE.Material | undefined): number {
  const color = (material as THREE.MeshStandardMaterial | undefined)?.color
  return color instanceof THREE.Color ? color.getHex(THREE.SRGBColorSpace) : 0xffffff
}

function textureImage(material: THREE.Material | undefined): THREE.Texture | null {
  const map = (material as THREE.MeshStandardMaterial | undefined)?.map
  const image = map?.image as { width?: number; height?: number } | undefined
  return map && image && (image.width ?? 0) > 0 && (image.height ?? 0) > 0 ? map : null
}

/** Build (and cache) a pixel sampler for a material's base-color texture. */
function samplerFor(
  material: THREE.Material | undefined,
  cache: Map<string, TextureSampler | null>
): TextureSampler | null {
  const texture = textureImage(material)
  if (!texture) return null
  const cached = cache.get(texture.uuid)
  if (cached !== undefined) return cached
  let sampler: TextureSampler | null = null
  try {
    const image = texture.image as CanvasImageSource & { width: number; height: number }
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context) {
      context.drawImage(image, 0, 0)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      const { width, height } = canvas
      const flipY = texture.flipY
      sampler = (u, v) => {
        const wrappedU = u - Math.floor(u)
        const wrappedV = v - Math.floor(v)
        const x = Math.min(width - 1, Math.floor(wrappedU * width))
        const row = flipY ? 1 - wrappedV : wrappedV
        const y = Math.min(height - 1, Math.floor(row * height))
        const at = (y * width + x) * 4
        return [pixels[at], pixels[at + 1], pixels[at + 2]]
      }
    }
  } catch {
    // Canvas may be unavailable (tests) or the image non-drawable; the flat
    // material color is the fallback.
    sampler = null
  }
  cache.set(texture.uuid, sampler)
  return sampler
}
