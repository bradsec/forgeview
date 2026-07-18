import * as THREE from 'three'

/**
 * "Make solid" for 3D printing: drop connected shells (closed surface
 * components) that are fully enclosed inside another shell of the same
 * geometry. The outer surface is untouched, so the printed appearance does
 * not change — only internal cavities and floating islands inside them
 * disappear.
 *
 * Method (standard approach for interior-shell removal): split the triangle
 * soup into connected components by welding coincident vertex positions,
 * then classify each component with a point-in-polyhedron parity test — a
 * ray cast from the component's extreme +X vertex crossing another
 * component's surface an odd number of times means it is enclosed by it.
 */

interface Shell {
  /** Triangle vertex positions, 9 floats per triangle (non-indexed). */
  positions: Float32Array
  triangleCount: number
  /** Extreme vertex with the largest X — the ray origin for parity tests. */
  extreme: THREE.Vector3
}

class UnionFind {
  private parent: Int32Array
  constructor(n: number) {
    this.parent = new Int32Array(n)
    for (let i = 0; i < n; i++) this.parent[i] = i
  }
  find(i: number): number {
    let root = i
    while (this.parent[root] !== root) root = this.parent[root]
    while (this.parent[i] !== root) {
      const next = this.parent[i]
      this.parent[i] = root
      i = next
    }
    return root
  }
  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent[rb] = ra
  }
}

function vertexKey(x: number, y: number, z: number): string {
  // Weld tolerance of 1e-6 model units merges STL's per-triangle duplicates
  return `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`
}

/** Split a geometry's triangles into connected shells by welded position. */
export function splitIntoShells(geometry: THREE.BufferGeometry): Shell[] {
  const source = geometry.index ? geometry.toNonIndexed() : geometry
  const pos = source.getAttribute('position')
  if (!pos) return []
  const triCount = Math.floor(pos.count / 3)
  if (triCount === 0) return []

  // Weld: map each corner to a canonical vertex id
  const keyToId = new Map<string, number>()
  const cornerVertexId = new Int32Array(triCount * 3)
  for (let corner = 0; corner < triCount * 3; corner++) {
    const key = vertexKey(pos.getX(corner), pos.getY(corner), pos.getZ(corner))
    let id = keyToId.get(key)
    if (id === undefined) {
      id = keyToId.size
      keyToId.set(key, id)
    }
    cornerVertexId[corner] = id
  }

  // Union triangle corners — triangles sharing a welded vertex connect
  const uf = new UnionFind(keyToId.size)
  for (let tri = 0; tri < triCount; tri++) {
    uf.union(cornerVertexId[tri * 3], cornerVertexId[tri * 3 + 1])
    uf.union(cornerVertexId[tri * 3], cornerVertexId[tri * 3 + 2])
  }

  // Group triangles by component root
  const groups = new Map<number, number[]>()
  for (let tri = 0; tri < triCount; tri++) {
    const root = uf.find(cornerVertexId[tri * 3])
    let list = groups.get(root)
    if (!list) {
      list = []
      groups.set(root, list)
    }
    list.push(tri)
  }

  const shells: Shell[] = []
  for (const tris of groups.values()) {
    const positions = new Float32Array(tris.length * 9)
    const extreme = new THREE.Vector3(-Infinity, 0, 0)
    let out = 0
    for (const tri of tris) {
      for (let corner = tri * 3; corner < tri * 3 + 3; corner++) {
        const x = pos.getX(corner)
        const y = pos.getY(corner)
        const z = pos.getZ(corner)
        positions[out++] = x
        positions[out++] = y
        positions[out++] = z
        if (x > extreme.x) extreme.set(x, y, z)
      }
    }
    shells.push({ positions, triangleCount: tris.length, extreme })
  }
  return shells
}

/**
 * True when `shell` is enclosed by `other`: a ray from the shell's extreme
 * +X vertex pointing further +X crosses the other shell's surface an odd
 * number of times. The slight direction jitter avoids grazing edges and
 * faces exactly parallel to the ray.
 */
function isEnclosedBy(shell: Shell, other: Shell): boolean {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(other.positions, 3))
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  const raycaster = new THREE.Raycaster(
    shell.extreme.clone(),
    new THREE.Vector3(1, 1e-4, 2e-4).normalize()
  )
  raycaster.far = Infinity
  const hits = raycaster.intersectObject(mesh, false)
  geometry.dispose()
  mesh.material.dispose()
  // Deduplicate hits at (numerically) the same distance — shared edges can
  // report the same crossing twice
  let crossings = 0
  let lastDistance = -Infinity
  for (const hit of hits) {
    if (hit.distance - lastDistance > 1e-9) crossings++
    lastDistance = hit.distance
  }
  return crossings % 2 === 1
}

export interface MakeSolidResult {
  geometry: THREE.BufferGeometry
  shellsKept: number
  shellsRemoved: number
}

/**
 * Remove enclosed internal shells from a geometry. Returns a new
 * non-indexed geometry with recomputed normals; the input is not modified.
 */
export function makeSolidGeometry(geometry: THREE.BufferGeometry): MakeSolidResult {
  const shells = splitIntoShells(geometry)
  if (shells.length <= 1) {
    const clone = geometry.index ? geometry.toNonIndexed() : geometry.clone()
    return { geometry: clone, shellsKept: shells.length, shellsRemoved: 0 }
  }

  const kept = shells.filter(
    (shell) => !shells.some((other) => other !== shell && isEnclosedBy(shell, other))
  )
  const survivors = kept.length > 0 ? kept : shells

  let total = 0
  for (const shell of survivors) total += shell.positions.length
  const positions = new Float32Array(total)
  let offset = 0
  for (const shell of survivors) {
    positions.set(shell.positions, offset)
    offset += shell.positions.length
  }
  const result = new THREE.BufferGeometry()
  result.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  result.computeVertexNormals()
  return {
    geometry: result,
    shellsKept: survivors.length,
    shellsRemoved: shells.length - survivors.length,
  }
}
