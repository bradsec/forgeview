import * as THREE from 'three'
import { computeOverhangFaceMask } from './overhangAnalysis'

export interface OverhangOverlayResult {
  group: THREE.Group
  hiddenMeshes: THREE.Mesh[]
  meshCount: number
  skippedMeshes: number
}

export function buildOverhangOverlay(
  meshes: THREE.Mesh[],
  thresholdDeg: number,
  isEligible: (m: THREE.Mesh) => boolean,
  highlightColor = 0xff3b30,
): OverhangOverlayResult {
  const group = new THREE.Group()
  group.userData.overhangOverlay = true
  const toHide: THREE.Mesh[] = []
  let meshCount = 0
  let skippedMeshes = 0
  const highlight = new THREE.Color(highlightColor)

  for (const mesh of meshes) {
    if (!isEligible(mesh)) { skippedMeshes++; continue }
    // A mesh the user hid (e.g. a split part toggled off in the Parts section)
    // is not part of the heatmap. It is not "ineligible" either, so do not
    // count it as skipped: just leave it alone.
    if (!mesh.visible) continue
    mesh.updateWorldMatrix(true, false)
    const source = mesh.geometry as THREE.BufferGeometry
    const worldGeo = source.index ? source.toNonIndexed() : source.clone()
    worldGeo.applyMatrix4(mesh.matrixWorld)

    const posAttr = worldGeo.getAttribute('position') as THREE.BufferAttribute
    const positions = posAttr.array as Float32Array
    const { mask } = computeOverhangFaceMask(positions, thresholdDeg)

    const baseHex = (mesh.material as THREE.MeshStandardMaterial)?.color?.getHex?.() ?? 0xb0b0b0
    const base = new THREE.Color(baseHex)
    const colors = new Float32Array(positions.length)
    const faceCount = Math.floor(positions.length / 9)
    for (let f = 0; f < faceCount; f++) {
      const c = mask[f] ? highlight : base
      for (let v = 0; v < 3; v++) {
        const o = (f * 3 + v) * 3
        colors[o] = c.r
        colors[o + 1] = c.g
        colors[o + 2] = c.b
      }
    }
    worldGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    worldGeo.computeVertexNormals()

    const overlayMesh = new THREE.Mesh(
      worldGeo,
      new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.45, metalness: 0.1, side: THREE.DoubleSide,
      }),
    )
    group.add(overlayMesh)

    toHide.push(mesh)
    meshCount++
  }

  // Hide the originals only after the whole loop succeeded. If a build throws
  // mid-loop the caller never adopts the overlay, so leaving every original
  // visible keeps the model recoverable.
  for (const m of toHide) m.visible = false

  return { group, hiddenMeshes: toHide, meshCount, skippedMeshes }
}

export function disposeOverhangOverlay(group: THREE.Group): void {
  for (const child of group.children) {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose()
      ;(child.material as THREE.Material).dispose()
    }
  }
  group.parent?.remove(group)
}
