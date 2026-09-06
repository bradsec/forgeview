import * as THREE from 'three'

export interface BuildVolumeColors {
  edge: number
  grid: number
}

/**
 * A wireframe box for a printer build volume: footprint `x` by `z`
 * millimetres, height `y`, base on the plane y=0, centred on x=z=0. Plus a
 * footprint grid on y=0. Line geometry only. The returned group is tagged
 * `userData.buildVolumeOverlay = true` so exporters skip it.
 */
export function buildBuildVolumeOverlay(
  volumeMm: { x: number; y: number; z: number },
  colors: BuildVolumeColors,
): THREE.Group {
  const group = new THREE.Group()
  group.userData.buildVolumeOverlay = true

  const safeX = volumeMm.x > 0 ? volumeMm.x : 1
  const safeY = volumeMm.y > 0 ? volumeMm.y : 1
  const safeZ = volumeMm.z > 0 ? volumeMm.z : 1

  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(safeX, safeY, safeZ)),
    new THREE.LineBasicMaterial({ color: colors.edge }),
  )
  box.position.set(0, safeY / 2, 0)
  group.add(box)

  const footprint = Math.max(safeX, safeZ)
  const divisions = Math.min(60, Math.max(4, Math.round(footprint / 10)))
  const grid = new THREE.GridHelper(footprint, divisions, colors.grid, colors.grid)
  grid.scale.set(safeX / footprint, 1, safeZ / footprint)
  grid.position.set(0, 0, 0)
  group.add(grid)

  return group
}

export function disposeBuildVolumeOverlay(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.LineSegments) {
      child.geometry.dispose()
      ;(child.material as THREE.Material).dispose()
    }
  })
  group.parent?.remove(group)
}
