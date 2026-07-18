import * as THREE from 'three'

interface Shell {
  positions: Float32Array
  triangles: number[]
  triangleCount: number
  samples: THREE.Vector3[]
  bounds: THREE.Box3
  closed: boolean
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
  return `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

export interface MeshHealth {
  triangles: number
  vertices: number
  boundaryEdges: number
  nonManifoldEdges: number
  duplicateFaces: number
  degenerateFaces: number
  watertight: boolean
}

export function analyzeGeometry(geometry: THREE.BufferGeometry): MeshHealth {
  const source = geometry.index ? geometry.toNonIndexed() : geometry
  const position = source.getAttribute('position')
  if (!position) {
    if (source !== geometry) source.dispose()
    return { triangles: 0, vertices: 0, boundaryEdges: 0, nonManifoldEdges: 0, duplicateFaces: 0, degenerateFaces: 0, watertight: false }
  }
  const vertexIds = new Map<string, number>()
  const cornerIds = new Int32Array(position.count)
  for (let corner = 0; corner < position.count; corner++) {
    const key = vertexKey(position.getX(corner), position.getY(corner), position.getZ(corner))
    if (!vertexIds.has(key)) vertexIds.set(key, vertexIds.size)
    cornerIds[corner] = vertexIds.get(key)!
  }
  const edges = new Map<string, number>()
  const faces = new Set<string>()
  let duplicateFaces = 0
  let degenerateFaces = 0
  const triangles = Math.floor(position.count / 3)
  for (let triangle = 0; triangle < triangles; triangle++) {
    const ids = [cornerIds[triangle * 3], cornerIds[triangle * 3 + 1], cornerIds[triangle * 3 + 2]]
    const a = new THREE.Vector3().fromBufferAttribute(position, triangle * 3)
    const b = new THREE.Vector3().fromBufferAttribute(position, triangle * 3 + 1)
    const c = new THREE.Vector3().fromBufferAttribute(position, triangle * 3 + 2)
    if (new Set(ids).size < 3 || new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).lengthSq() <= 1e-20) {
      degenerateFaces++
      continue
    }
    const face = [...ids].sort((x, y) => x - y).join(':')
    if (faces.has(face)) duplicateFaces++
    else faces.add(face)
    for (let edge = 0; edge < 3; edge++) {
      const key = edgeKey(ids[edge], ids[(edge + 1) % 3])
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
  }
  const boundaryEdges = [...edges.values()].filter((count) => count === 1).length
  const nonManifoldEdges = [...edges.values()].filter((count) => count > 2).length
  const result = {
    triangles,
    vertices: vertexIds.size,
    boundaryEdges,
    nonManifoldEdges,
    duplicateFaces,
    degenerateFaces,
    watertight: triangles > 0 && boundaryEdges === 0 && nonManifoldEdges === 0 && duplicateFaces === 0 && degenerateFaces === 0,
  }
  if (source !== geometry) source.dispose()
  return result
}

function repairGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  const position = source.getAttribute('position')
  if (!position || position.count < 3) return source

  const keyToId = new Map<string, number>()
  const representative = new Map<number, number>()
  const cornerIds = new Int32Array(position.count)
  for (let corner = 0; corner < position.count; corner++) {
    const key = vertexKey(position.getX(corner), position.getY(corner), position.getZ(corner))
    let id = keyToId.get(key)
    if (id === undefined) {
      id = keyToId.size
      keyToId.set(key, id)
      representative.set(id, corner)
    }
    cornerIds[corner] = id
  }

  const indices: number[] = []
  const materials: number[] = []
  const seenTriangles = new Set<string>()
  for (let triangle = 0; triangle < Math.floor(position.count / 3); triangle++) {
    const corners = [triangle * 3, triangle * 3 + 1, triangle * 3 + 2]
    const ids = corners.map((corner) => cornerIds[corner])
    if (new Set(ids).size < 3) continue
    const key = [...ids].sort((a, b) => a - b).join(':')
    if (seenTriangles.has(key)) continue
    const a = new THREE.Vector3().fromBufferAttribute(position, corners[0])
    const b = new THREE.Vector3().fromBufferAttribute(position, corners[1])
    const c = new THREE.Vector3().fromBufferAttribute(position, corners[2])
    if (new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).lengthSq() <= 1e-20) continue
    seenTriangles.add(key)
    indices.push(...corners)
    materials.push(materialIndexForTriangle(source, triangle))
  }

  const edgeUses = new Map<string, Array<{ from: number; to: number; material: number }>>()
  for (let triangle = 0; triangle < indices.length / 3; triangle++) {
    const ids = [cornerIds[indices[triangle * 3]], cornerIds[indices[triangle * 3 + 1]], cornerIds[indices[triangle * 3 + 2]]]
    for (let edge = 0; edge < 3; edge++) {
      const from = ids[edge]
      const to = ids[(edge + 1) % 3]
      const key = edgeKey(from, to)
      const uses = edgeUses.get(key) ?? []
      uses.push({ from, to, material: materials[triangle] })
      edgeUses.set(key, uses)
    }
  }

  const boundary = [...edgeUses.values()].filter((uses) => uses.length === 1).map((uses) => uses[0])
  const neighbours = new Map<number, Set<number>>()
  for (const edge of boundary) {
    if (!neighbours.has(edge.from)) neighbours.set(edge.from, new Set())
    if (!neighbours.has(edge.to)) neighbours.set(edge.to, new Set())
    neighbours.get(edge.from)!.add(edge.to)
    neighbours.get(edge.to)!.add(edge.from)
  }

  const visited = new Set<string>()
  for (const startEdge of boundary) {
    const startKey = edgeKey(startEdge.from, startEdge.to)
    if (visited.has(startKey)) continue
    const loop = [startEdge.from]
    let previous = startEdge.from
    let current = startEdge.to
    let valid = true
    while (current !== loop[0]) {
      loop.push(current)
      const candidates = [...(neighbours.get(current) ?? [])]
      if (candidates.length !== 2) { valid = false; break }
      const next = candidates[0] === previous ? candidates[1] : candidates[0]
      const key = edgeKey(current, next)
      if (visited.has(key)) { valid = false; break }
      visited.add(key)
      previous = current
      current = next
      if (loop.length > boundary.length) { valid = false; break }
    }
    visited.add(startKey)
    if (!valid || loop.length < 3) continue

    const points = loop.map((id) => {
      const corner = representative.get(id)!
      return new THREE.Vector3(position.getX(corner), position.getY(corner), position.getZ(corner))
    })
    const normal = new THREE.Vector3()
    for (let index = 0; index < points.length; index++) {
      const point = points[index]
      const next = points[(index + 1) % points.length]
      normal.x += (point.y - next.y) * (point.z + next.z)
      normal.y += (point.z - next.z) * (point.x + next.x)
      normal.z += (point.x - next.x) * (point.y + next.y)
    }
    if (normal.lengthSq() <= 1e-20) continue
    normal.normalize()
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, points[0])
    const scale = new THREE.Box3().setFromPoints(points).getSize(new THREE.Vector3()).length()
    if (points.some((point) => Math.abs(plane.distanceToPoint(point)) > Math.max(scale * 1e-6, 1e-7))) continue
    const axis = Math.abs(normal.x) > Math.abs(normal.y)
      ? (Math.abs(normal.x) > Math.abs(normal.z) ? 'x' : 'z')
      : (Math.abs(normal.y) > Math.abs(normal.z) ? 'y' : 'z')
    const projected = points.map((point) => axis === 'x'
      ? new THREE.Vector2(point.y, point.z)
      : axis === 'y' ? new THREE.Vector2(point.x, point.z) : new THREE.Vector2(point.x, point.y))
    const faces = THREE.ShapeUtils.triangulateShape(projected, [])
    const material = startEdge.material
    for (const face of faces) {
      indices.push(...face.map((index) => representative.get(loop[index])!))
      materials.push(material)
    }
  }

  source.setIndex(indices)
  source.clearGroups()
  let groupStart = 0
  let activeMaterial = materials[0] ?? 0
  for (let triangle = 1; triangle <= materials.length; triangle++) {
    if (triangle === materials.length || materials[triangle] !== activeMaterial) {
      source.addGroup(groupStart * 3, (triangle - groupStart) * 3, activeMaterial)
      groupStart = triangle
      activeMaterial = materials[triangle]
    }
  }
  return source
}

function shellSamples(positions: Float32Array): { samples: THREE.Vector3[]; bounds: THREE.Box3 } {
  const bounds = new THREE.Box3()
  const point = new THREE.Vector3()
  const extrema = Array.from({ length: 6 }, () => new THREE.Vector3())
  const scores = [-Infinity, Infinity, -Infinity, Infinity, -Infinity, Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    point.set(positions[i], positions[i + 1], positions[i + 2])
    bounds.expandByPoint(point)
    const values = [point.x, point.x, point.y, point.y, point.z, point.z]
    for (let axis = 0; axis < 6; axis++) {
      const better = axis % 2 === 0 ? values[axis] > scores[axis] : values[axis] < scores[axis]
      if (better) {
        scores[axis] = values[axis]
        extrema[axis].copy(point)
      }
    }
  }
  return { samples: extrema, bounds }
}

/** Split triangles into edge-connected shells and record manifold closure. */
export function splitIntoShells(geometry: THREE.BufferGeometry): Shell[] {
  const source = geometry.index ? geometry.toNonIndexed() : geometry
  const pos = source.getAttribute('position')
  if (!pos) {
    if (source !== geometry) source.dispose()
    return []
  }
  const triCount = Math.floor(pos.count / 3)
  if (triCount === 0) {
    if (source !== geometry) source.dispose()
    return []
  }

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

  const uf = new UnionFind(triCount)
  const edgeTriangles = new Map<string, number[]>()
  for (let tri = 0; tri < triCount; tri++) {
    const ids = [cornerVertexId[tri * 3], cornerVertexId[tri * 3 + 1], cornerVertexId[tri * 3 + 2]]
    for (let edge = 0; edge < 3; edge++) {
      const key = edgeKey(ids[edge], ids[(edge + 1) % 3])
      const connected = edgeTriangles.get(key)
      if (connected) {
        for (const other of connected) uf.union(tri, other)
        connected.push(tri)
      } else {
        edgeTriangles.set(key, [tri])
      }
    }
  }

  const groups = new Map<number, number[]>()
  for (let tri = 0; tri < triCount; tri++) {
    const root = uf.find(tri)
    const group = groups.get(root)
    if (group) group.push(tri)
    else groups.set(root, [tri])
  }

  const shells: Shell[] = []
  for (const triangles of groups.values()) {
    const positions = new Float32Array(triangles.length * 9)
    const shellEdges = new Map<string, number>()
    let out = 0
    for (const tri of triangles) {
      const ids = [cornerVertexId[tri * 3], cornerVertexId[tri * 3 + 1], cornerVertexId[tri * 3 + 2]]
      for (let edge = 0; edge < 3; edge++) {
        const key = edgeKey(ids[edge], ids[(edge + 1) % 3])
        shellEdges.set(key, (shellEdges.get(key) ?? 0) + 1)
      }
      for (let corner = tri * 3; corner < tri * 3 + 3; corner++) {
        positions[out++] = pos.getX(corner)
        positions[out++] = pos.getY(corner)
        positions[out++] = pos.getZ(corner)
      }
    }
    const { samples, bounds } = shellSamples(positions)
    shells.push({
      positions,
      triangles,
      triangleCount: triangles.length,
      samples,
      bounds,
      closed: [...shellEdges.values()].every((count) => count === 2),
    })
  }
  if (source !== geometry) source.dispose()
  return shells
}

function pointIsInside(point: THREE.Vector3, other: Shell): boolean {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(other.positions, 3))
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(geometry, material)
  const raycaster = new THREE.Raycaster(point, new THREE.Vector3(1, 1e-4, 2e-4).normalize())
  const hits = raycaster.intersectObject(mesh, false)
  geometry.dispose()
  material.dispose()
  let crossings = 0
  let lastDistance = -Infinity
  const tolerance = Math.max(other.bounds.getSize(new THREE.Vector3()).length() * 1e-9, 1e-9)
  for (const hit of hits) {
    if (hit.distance - lastDistance > tolerance) crossings++
    lastDistance = hit.distance
  }
  return crossings % 2 === 1
}

function isEnclosedBy(shell: Shell, other: Shell): boolean {
  if (!other.closed || !other.bounds.containsBox(shell.bounds)) return false
  return shell.samples.every((sample) => pointIsInside(sample, other))
}

function keptTriangles(geometry: THREE.BufferGeometry): { shells: Shell[]; kept: number[]; removed: number } {
  const shells = splitIntoShells(geometry)
  const survivors = shells.filter(
    (shell) => !shells.some((other) => other !== shell && isEnclosedBy(shell, other))
  )
  const effective = survivors.length > 0 ? survivors : shells
  return {
    shells,
    kept: effective.flatMap((shell) => shell.triangles).sort((a, b) => a - b),
    removed: shells.length - effective.length,
  }
}

function materialIndexForTriangle(geometry: THREE.BufferGeometry, triangle: number): number {
  const offset = triangle * 3
  const group = geometry.groups.find((candidate) => offset >= candidate.start && offset < candidate.start + candidate.count)
  return group?.materialIndex ?? 0
}

function selectTriangles(geometry: THREE.BufferGeometry, triangles: number[]): THREE.BufferGeometry {
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  const result = source.clone()
  const index: number[] = []
  result.clearGroups()
  let activeMaterial = -1
  let activeStart = 0
  for (const triangle of triangles) {
    index.push(triangle * 3, triangle * 3 + 1, triangle * 3 + 2)
    const materialIndex = materialIndexForTriangle(source, triangle)
    if (materialIndex !== activeMaterial) {
      if (activeMaterial >= 0) result.addGroup(activeStart, index.length - 3 - activeStart, activeMaterial)
      activeMaterial = materialIndex
      activeStart = index.length - 3
    }
  }
  if (activeMaterial >= 0) result.addGroup(activeStart, index.length - activeStart, activeMaterial)
  result.setIndex(index)
  return result
}

export interface MakeSolidResult {
  geometry: THREE.BufferGeometry
  shellsKept: number
  shellsRemoved: number
}

/** Remove closed shells fully enclosed by another closed shell. */
export function makeSolidGeometry(geometry: THREE.BufferGeometry): MakeSolidResult {
  const repaired = repairGeometry(geometry)
  const classified = keptTriangles(repaired)
  const result = {
    geometry: selectTriangles(repaired, classified.kept),
    shellsKept: classified.shells.length - classified.removed,
    shellsRemoved: classified.removed,
  }
  repaired.dispose()
  return result
}

export interface MakeSolidGeometriesResult {
  geometries: Array<THREE.BufferGeometry | null>
  shellsKept: number
  shellsRemoved: number
}

/** Classify shells across mesh boundaries, then preserve each source mesh's attributes. */
export function makeSolidGeometries(geometries: THREE.BufferGeometry[]): MakeSolidGeometriesResult {
  const sources = geometries.map(repairGeometry)
  const positions: number[] = []
  const triangleOffsets: number[] = []
  let triangleOffset = 0
  for (const source of sources) {
    triangleOffsets.push(triangleOffset)
    const position = source.getAttribute('position')
    for (let i = 0; i < position.count; i++) positions.push(position.getX(i), position.getY(i), position.getZ(i))
    triangleOffset += Math.floor(position.count / 3)
  }
  const combined = new THREE.BufferGeometry()
  combined.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const classified = keptTriangles(combined)
  const keptSet = new Set(classified.kept)
  const filtered = sources.map((source, meshIndex) => {
    const start = triangleOffsets[meshIndex]
    const count = Math.floor(source.getAttribute('position').count / 3)
    const local: number[] = []
    for (let triangle = 0; triangle < count; triangle++) {
      if (keptSet.has(start + triangle)) local.push(triangle)
    }
    return local.length > 0 ? selectTriangles(source, local) : null
  })
  combined.dispose()
  for (const source of sources) source.dispose()
  return {
    geometries: filtered,
    shellsKept: classified.shells.length - classified.removed,
    shellsRemoved: classified.removed,
  }
}
