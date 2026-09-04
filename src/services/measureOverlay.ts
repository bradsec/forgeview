import * as THREE from 'three'

export interface MeasureOverlay {
  group: THREE.Group
  markerA: THREE.Mesh
  markerB: THREE.Mesh
  line: THREE.Line
  pointA: THREE.Vector3 | null
  pointB: THREE.Vector3 | null
}

export function buildMeasureOverlay(markerRadius: number): MeasureOverlay {
  const mat = new THREE.MeshBasicMaterial({ color: 0x4c9ffe, depthTest: false })
  const geoA = new THREE.SphereGeometry(markerRadius, 16, 12)
  const geoB = geoA.clone()
  const markerA = new THREE.Mesh(geoA, mat)
  const markerB = new THREE.Mesh(geoB, mat)
  markerA.visible = markerB.visible = false
  markerA.renderOrder = markerB.renderOrder = 1000

  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(),
    new THREE.Vector3(),
  ])
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x4c9ffe, depthTest: false }))
  line.visible = false
  line.renderOrder = 1000

  const group = new THREE.Group()
  group.userData.measureOverlay = true
  group.add(markerA, markerB, line)
  return { group, markerA, markerB, line, pointA: null, pointB: null }
}

export function setMeasurePoint(ov: MeasureOverlay, p: THREE.Vector3): 'A' | 'B' | 'reset' {
  if (ov.pointA && ov.pointB) {
    ov.pointB = null
    ov.markerB.visible = false
    ov.line.visible = false
    ov.pointA = p.clone()
    ov.markerA.position.copy(p)
    ov.markerA.visible = true
    return 'reset'
  }
  if (!ov.pointA) {
    ov.pointA = p.clone()
    ov.markerA.position.copy(p)
    ov.markerA.visible = true
    return 'A'
  }
  ov.pointB = p.clone()
  ov.markerB.position.copy(p)
  ov.markerB.visible = true
  const attr = ov.line.geometry.getAttribute('position') as THREE.BufferAttribute
  attr.setXYZ(0, ov.pointA.x, ov.pointA.y, ov.pointA.z)
  attr.setXYZ(1, ov.pointB.x, ov.pointB.y, ov.pointB.z)
  attr.needsUpdate = true
  ov.line.geometry.computeBoundingSphere()
  ov.line.visible = true
  return 'B'
}

export function measureDistance(ov: MeasureOverlay, unitInMm: number): number | null {
  if (!ov.pointA || !ov.pointB) return null
  return ov.pointA.distanceTo(ov.pointB) * unitInMm
}

export function pickSurfacePoint(
  meshes: THREE.Mesh[],
  raycaster: THREE.Raycaster,
): THREE.Vector3 | null {
  const hit = raycaster.intersectObjects(meshes, false)[0]
  return hit ? hit.point.clone() : null
}

export function disposeMeasureOverlay(ov: MeasureOverlay): void {
  ov.markerA.geometry.dispose()
  ov.markerB.geometry.dispose()
  ;(ov.markerA.material as THREE.Material).dispose()
  ov.line.geometry.dispose()
  ;(ov.line.material as THREE.Material).dispose()
  ov.group.parent?.remove(ov.group)
}
