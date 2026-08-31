import * as THREE from 'three'
import { extractBoundaryLoops, centroidFan, type BoundaryLoop } from './boundaryLoops'

export interface OverlayEntry {
  mesh: THREE.Mesh
  loop: BoundaryLoop
  /** The loop ring in the mesh's own local space, before `mesh.matrixWorld`
   * places the cap/outline. `fillLoop` needs these: it KEY-matches every point
   * against the geometry's own vertices, so a world-space round trip through the
   * inverse matrix can miss. */
  localPoints: [number, number, number][]
  cap: THREE.Mesh
  outline: THREE.LineLoop
  group: THREE.Group
}

export interface OverlayMaterials {
  cap: THREE.Material
  capHover: THREE.Material
  outline: THREE.Material
}

export function makeOverlayMaterials(color = 0x4c9ffe): OverlayMaterials {
  return {
    cap: new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false,
    }),
    capHover: new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false,
    }),
    outline: new THREE.LineBasicMaterial({ color, transparent: true, depthTest: false }),
  }
}

function transformedFlat(points: [number, number, number][], m: THREE.Matrix4): Float32Array {
  const out = new Float32Array(points.length * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < points.length; i++) {
    v.set(points[i][0], points[i][1], points[i][2]).applyMatrix4(m)
    out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z
  }
  return out
}

function transformedFan(loop: [number, number, number][], m: THREE.Matrix4): Float32Array {
  const fan = centroidFan(loop) // local space
  const v = new THREE.Vector3()
  for (let i = 0; i < fan.length; i += 3) {
    v.set(fan[i], fan[i + 1], fan[i + 2]).applyMatrix4(m)
    fan[i] = v.x; fan[i + 1] = v.y; fan[i + 2] = v.z
  }
  return fan
}

export function buildLoopOverlays(
  meshes: THREE.Mesh[],
  isEligible: (m: THREE.Mesh) => boolean,
  materials: OverlayMaterials,
): { entries: OverlayEntry[]; skippedMeshes: number } {
  const entries: OverlayEntry[] = []
  let skippedMeshes = 0
  for (const mesh of meshes) {
    if (!isEligible(mesh)) { skippedMeshes++; continue }
    mesh.updateWorldMatrix(true, false)
    const { loops } = extractBoundaryLoops(mesh.geometry as THREE.BufferGeometry)
    for (const loop of loops) {
      const capGeo = new THREE.BufferGeometry()
      capGeo.setAttribute('position', new THREE.BufferAttribute(transformedFan(loop.points, mesh.matrixWorld), 3))
      capGeo.computeVertexNormals()
      const cap = new THREE.Mesh(capGeo, materials.cap)
      cap.renderOrder = 999

      const outGeo = new THREE.BufferGeometry()
      outGeo.setAttribute('position', new THREE.BufferAttribute(transformedFlat(loop.points, mesh.matrixWorld), 3))
      const outline = new THREE.LineLoop(outGeo, materials.outline)
      outline.renderOrder = 1000

      const group = new THREE.Group()
      group.userData.holeOverlay = true
      group.add(cap, outline)
      entries.push({ mesh, loop, localPoints: loop.points, cap, outline, group })
    }
  }
  return { entries, skippedMeshes }
}

export function disposeLoopOverlays(entries: OverlayEntry[]): void {
  for (const e of entries) {
    e.cap.geometry.dispose()
    e.outline.geometry.dispose()
    e.group.parent?.remove(e.group)
  }
}

export function pickOverlay(entries: OverlayEntry[], raycaster: THREE.Raycaster): number {
  let best = -1
  let bestDist = Infinity
  for (let i = 0; i < entries.length; i++) {
    const hit = raycaster.intersectObject(entries[i].cap, false)[0]
    if (hit && hit.distance < bestDist) { bestDist = hit.distance; best = i }
  }
  return best
}
