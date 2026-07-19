/**
 * Exterior-shell classification: decide, per source triangle, whether it can
 * be reached from the air surrounding the model. Triangles that cannot —
 * walls of enclosed cavities, faces buried inside overlapping parts — are the
 * model's hidden interior. Deleting them fills the model solid and joins
 * touching parts under one continuous outside skin while the kept triangles
 * stay byte-identical to the input, so the visible surface never changes.
 */

function index3(x: number, y: number, z: number, size: number): number {
  return x + size * (y + size * z)
}

interface Grid {
  min: [number, number, number]
  step: number
  size: number
}

function gridFor(positions: Float32Array, resolution: number): Grid {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], positions[i + axis])
    max[axis] = Math.max(max[axis], positions[i + axis])
  }
  const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-12)
  // Three padding voxels per side guarantee a connected ring of outside air.
  const step = span / (resolution - 6)
  for (let axis = 0; axis < 3; axis++) {
    const center = (min[axis] + max[axis]) / 2
    min[axis] = center - (step * resolution) / 2
  }
  return { min, step, size: resolution }
}

/**
 * Visit the voxels a triangle touches, by sampling it at roughly half-voxel
 * spacing (a triangle smaller than that still contributes its three corners
 * and centroid, so nothing is skipped).
 */
function sampleTriangle(
  positions: Float32Array,
  triangle: number,
  grid: Grid,
  visit: (index: number) => boolean
): boolean {
  const { min, step, size } = grid
  const offset = triangle * 9
  const ax = (positions[offset] - min[0]) / step
  const ay = (positions[offset + 1] - min[1]) / step
  const az = (positions[offset + 2] - min[2]) / step
  const bx = (positions[offset + 3] - min[0]) / step
  const by = (positions[offset + 4] - min[1]) / step
  const bz = (positions[offset + 5] - min[2]) / step
  const cx = (positions[offset + 6] - min[0]) / step
  const cy = (positions[offset + 7] - min[1]) / step
  const cz = (positions[offset + 8] - min[2]) / step
  const edge = Math.max(
    Math.abs(bx - ax), Math.abs(by - ay), Math.abs(bz - az),
    Math.abs(cx - ax), Math.abs(cy - ay), Math.abs(cz - az),
    Math.abs(cx - bx), Math.abs(cy - by), Math.abs(cz - bz)
  )
  const n = Math.min(192, Math.max(1, Math.ceil(edge * 2)))
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n - i; j++) {
      const u = i / n
      const v = j / n
      const w = 1 - u - v
      const x = Math.max(0, Math.min(size - 1, Math.floor(w * ax + u * bx + v * cx)))
      const y = Math.max(0, Math.min(size - 1, Math.floor(w * ay + u * by + v * cy)))
      const z = Math.max(0, Math.min(size - 1, Math.floor(w * az + u * bz + v * cz)))
      if (visit(index3(x, y, z, size))) return true
    }
  }
  return false
}

/**
 * Flag each input triangle as exterior (1) or hidden interior (0).
 * `positions` is a non-indexed triangle soup, 9 floats per triangle.
 */
export function exteriorTriangleFlags(
  positions: Float32Array,
  resolution: number,
  progress: (percent: number, phase: string) => void = () => {}
): Uint8Array {
  const triangles = Math.floor(positions.length / 9)
  const flags = new Uint8Array(triangles)
  if (triangles === 0) return flags
  const grid = gridFor(positions, resolution)
  const size = grid.size

  const surface = new Uint8Array(size * size * size)
  for (let triangle = 0; triangle < triangles; triangle++) {
    sampleTriangle(positions, triangle, grid, (index) => {
      surface[index] = 1
      return false
    })
    if (triangle % 100000 === 0) progress(5 + Math.round((triangle / triangles) * 40), 'Mapping model surface')
  }

  // Flood the outside air: every non-surface voxel reachable from the grid
  // boundary. Anything the flood cannot reach is enclosed by the model.
  progress(50, 'Tracing outside air')
  const outside = new Uint8Array(surface.length)
  const queue = new Int32Array(surface.length)
  let head = 0
  let tail = 0
  const enqueue = (x: number, y: number, z: number) => {
    const index = index3(x, y, z, size)
    if (surface[index] || outside[index]) return
    outside[index] = 1
    queue[tail++] = index
  }
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) { enqueue(0, y, z); enqueue(size - 1, y, z) }
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) { enqueue(x, 0, z); enqueue(x, size - 1, z) }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { enqueue(x, y, 0); enqueue(x, y, size - 1) }
  while (head < tail) {
    const current = queue[head++]
    const x = current % size
    const yz = (current - x) / size
    const y = yz % size
    const z = (yz - y) / size
    if (x > 0) enqueue(x - 1, y, z)
    if (x + 1 < size) enqueue(x + 1, y, z)
    if (y > 0) enqueue(x, y - 1, z)
    if (y + 1 < size) enqueue(x, y + 1, z)
    if (z > 0) enqueue(x, y, z - 1)
    if (z + 1 < size) enqueue(x, y, z + 1)
  }

  // A surface voxel near outside air is visible; spread outside-ness onto the
  // surface so triangle classification is a single lookup. Two dilation steps
  // give a safety margin: detail recessed just behind the outermost surface
  // voxels (grooves, creases, panel gaps) stays kept instead of being treated
  // as interior.
  progress(60, 'Marking reachable surface')
  let reachable = outside
  for (let pass = 0; pass < 2; pass++) {
    const grown = new Uint8Array(reachable)
    for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const index = index3(x, y, z, size)
      if (!reachable[index]) continue
      if (x > 0) grown[index - 1] = 1
      if (x + 1 < size) grown[index + 1] = 1
      if (y > 0) grown[index - size] = 1
      if (y + 1 < size) grown[index + size] = 1
      if (z > 0) grown[index - size * size] = 1
      if (z + 1 < size) grown[index + size * size] = 1
    }
    reachable = grown
  }

  for (let triangle = 0; triangle < triangles; triangle++) {
    flags[triangle] = sampleTriangle(positions, triangle, grid, (index) => reachable[index] === 1) ? 1 : 0
    if (triangle % 100000 === 0) progress(65 + Math.round((triangle / triangles) * 30), 'Classifying triangles')
  }
  return flags
}

interface SolidMesh {
  /** xyz per vertex id; cap centroids are appended as new ids. */
  vertexPosition: number[]
  /** vertex-id triples, winding preserved from the source soup. */
  faces: number[]
}

function buildDirectedEdges(mesh: SolidMesh): Map<number, number> {
  const stride = mesh.vertexPosition.length / 3 + 1
  const directed = new Map<number, number>()
  for (let face = 0; face < mesh.faces.length; face += 3) {
    const [a, b, c] = [mesh.faces[face], mesh.faces[face + 1], mesh.faces[face + 2]]
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      directed.set(u * stride + v, (directed.get(u * stride + v) ?? 0) + 1)
    }
  }
  return directed
}

/** Drop degenerate triangles and exact duplicate faces in place. */
function dedupeFaces(mesh: SolidMesh): void {
  const kept: number[] = []
  const seen = new Set<string>()
  for (let face = 0; face < mesh.faces.length; face += 3) {
    const [a, b, c] = [mesh.faces[face], mesh.faces[face + 1], mesh.faces[face + 2]]
    if (a === b || b === c || c === a) continue
    const key = [a, b, c].sort((x, y) => x - y).join(':')
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(a, b, c)
  }
  mesh.faces = kept
}

function boundaryEdgeList(mesh: SolidMesh): Array<[number, number]> {
  const stride = mesh.vertexPosition.length / 3 + 1
  const directed = buildDirectedEdges(mesh)
  const boundary: Array<[number, number]> = []
  for (const [packed, count] of directed) {
    const u = Math.floor(packed / stride)
    const v = packed % stride
    if (count === 1 && !directed.has(v * stride + u)) boundary.push([u, v])
  }
  return boundary
}

/**
 * Cap boundary-edge loops with centroid fans. Chains follow the most
 * geometrically continuous outgoing edge at junction vertices (a figure-8
 * then splits into two clean loops instead of one broken walk), and a walk
 * that cannot close releases its edges for later walks. Cap winding follows
 * the surrounding surface: boundary direction u->v means the missing twin is
 * v->u, which the fan triangle (v, u, centroid) supplies.
 */
function capBoundaryLoops(mesh: SolidMesh): void {
  const boundary = boundaryEdgeList(mesh)
  if (boundary.length === 0) return
  const pos = mesh.vertexPosition
  const outgoing = new Map<number, number[]>()
  for (const [u, v] of boundary) {
    const list = outgoing.get(u)
    if (list) list.push(v)
    else outgoing.set(u, [v])
  }
  const stride = pos.length / 3 + 1
  const consumed = new Set<number>()
  const continuity = (from: number, via: number, to: number) => {
    const ax = pos[via * 3] - pos[from * 3]
    const ay = pos[via * 3 + 1] - pos[from * 3 + 1]
    const az = pos[via * 3 + 2] - pos[from * 3 + 2]
    const bx = pos[to * 3] - pos[via * 3]
    const by = pos[to * 3 + 1] - pos[via * 3 + 1]
    const bz = pos[to * 3 + 2] - pos[via * 3 + 2]
    const lengths = Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz)
    return lengths > 0 ? (ax * bx + ay * by + az * bz) / lengths : -2
  }
  for (const [start] of outgoing) {
    let previous = -1
    let current = start
    const loop: number[] = []
    const walked: number[] = []
    for (let steps = 0; steps <= boundary.length; steps++) {
      const candidates = (outgoing.get(current) ?? []).filter((v) => !consumed.has(current * stride + v))
      if (candidates.length === 0) break
      const next = previous < 0
        ? candidates[0]
        : candidates.reduce((best, v) => continuity(previous, current, v) > continuity(previous, current, best) ? v : best)
      consumed.add(current * stride + next)
      walked.push(current * stride + next)
      loop.push(current)
      previous = current
      current = next
      if (current === start) break
    }
    if (current !== start || loop.length < 3) {
      for (const edge of walked) consumed.delete(edge)
      continue
    }
    const centroid = [0, 0, 0]
    for (const id of loop) for (let axis = 0; axis < 3; axis++) centroid[axis] += pos[id * 3 + axis]
    for (let axis = 0; axis < 3; axis++) centroid[axis] /= loop.length
    const centroidId = pos.length / 3
    pos.push(centroid[0], centroid[1], centroid[2])
    for (let i = 0; i < loop.length; i++) {
      mesh.faces.push(loop[(i + 1) % loop.length], loop[i], centroidId)
    }
  }
}

/**
 * Last-resort closure: fan every remaining boundary edge to the centroid of
 * its connected component of boundary edges. Unlike loop walking this cannot
 * fail on tangled or pinched chains — each open edge u→v receives its missing
 * twin from the fan triangle (v, u, centroid), and the new centroid spokes
 * pair up wherever a vertex has one incoming and one outgoing boundary edge.
 */
function capRemainingBoundary(mesh: SolidMesh): void {
  const boundary = boundaryEdgeList(mesh)
  if (boundary.length === 0) return
  const pos = mesh.vertexPosition
  const component = new Map<number, number>()
  const find = (id: number): number => {
    let root = id
    while (component.get(root) !== root) root = component.get(root)!
    while (component.get(id) !== root) {
      const next = component.get(id)!
      component.set(id, root)
      id = next
    }
    return root
  }
  for (const [u, v] of boundary) {
    if (!component.has(u)) component.set(u, u)
    if (!component.has(v)) component.set(v, v)
    component.set(find(u), find(v))
  }
  const centroids = new Map<number, { sum: [number, number, number]; count: number; id: number }>()
  for (const [u, v] of boundary) {
    const root = find(u)
    let entry = centroids.get(root)
    if (!entry) {
      entry = { sum: [0, 0, 0], count: 0, id: -1 }
      centroids.set(root, entry)
    }
    for (const vertex of [u, v]) {
      for (let axis = 0; axis < 3; axis++) entry.sum[axis] += pos[vertex * 3 + axis]
      entry.count++
    }
  }
  for (const entry of centroids.values()) {
    entry.id = pos.length / 3
    pos.push(entry.sum[0] / entry.count, entry.sum[1] / entry.count, entry.sum[2] / entry.count)
  }
  for (const [u, v] of boundary) {
    mesh.faces.push(v, u, centroids.get(find(u))!.id)
  }
}

/**
 * Merge boundary vertices that sit within `tolerance` of each other and remap
 * faces onto the survivors. Only rim vertices of open edges move, so the
 * visible surface stays put while crack rims wider than the base weld snap
 * together.
 */
function snapBoundaryVertices(mesh: SolidMesh, tolerance: number): void {
  const boundary = boundaryEdgeList(mesh)
  if (boundary.length === 0) return
  const ids = new Set<number>()
  for (const [u, v] of boundary) { ids.add(u); ids.add(v) }
  const buckets = new Map<string, number>()
  const remap = new Map<number, number>()
  const pos = mesh.vertexPosition
  for (const id of ids) {
    const key = `${Math.round(pos[id * 3] / tolerance)},${Math.round(pos[id * 3 + 1] / tolerance)},${Math.round(pos[id * 3 + 2] / tolerance)}`
    const existing = buckets.get(key)
    if (existing === undefined) buckets.set(key, id)
    else remap.set(id, existing)
  }
  if (remap.size === 0) return
  for (let i = 0; i < mesh.faces.length; i++) {
    const mapped = remap.get(mesh.faces[i])
    if (mapped !== undefined) mesh.faces[i] = mapped
  }
  dedupeFaces(mesh)
}

/**
 * Finish a kept-exterior soup into the best solid the data allows:
 *
 * 1. Weld vertices at a scale-relative tolerance, closing hairline cracks.
 * 2. Drop degenerate and exact duplicate (double-wall) faces.
 * 3. Cap boundary-edge loops with centroid fans; junction loops end up inside
 *    the filled volume, skin holes become flat caps.
 * 4. While open edges remain, snap boundary rim vertices together at a
 *    growing (still sub-visible) tolerance and cap again.
 */
export function finalizeSolid(positions: Float32Array): Float32Array {
  const triangles = Math.floor(positions.length / 9)
  if (triangles === 0) return positions

  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
    bounds[axis] = Math.min(bounds[axis], positions[i + axis])
    bounds[axis + 3] = Math.max(bounds[axis + 3], positions[i + axis])
  }
  const diagonal = Math.hypot(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2])
  const quantum = Math.max(diagonal * 1e-5, 1e-9)

  const vertexIds = new Map<string, number>()
  const mesh: SolidMesh = { vertexPosition: [], faces: [] }
  for (let corner = 0; corner < triangles * 3; corner++) {
    const offset = corner * 3
    const key = `${Math.round(positions[offset] / quantum)},${Math.round(positions[offset + 1] / quantum)},${Math.round(positions[offset + 2] / quantum)}`
    let id = vertexIds.get(key)
    if (id === undefined) {
      id = vertexIds.size
      vertexIds.set(key, id)
      mesh.vertexPosition.push(positions[offset], positions[offset + 1], positions[offset + 2])
    }
    mesh.faces.push(id)
  }

  dedupeFaces(mesh)
  capBoundaryLoops(mesh)
  for (const factor of [20, 100]) {
    if (boundaryEdgeList(mesh).length === 0) break
    snapBoundaryVertices(mesh, quantum * factor)
    capBoundaryLoops(mesh)
  }
  capRemainingBoundary(mesh)

  const result = new Float32Array(mesh.faces.length * 3)
  let out = 0
  for (const id of mesh.faces) {
    result[out++] = mesh.vertexPosition[id * 3]
    result[out++] = mesh.vertexPosition[id * 3 + 1]
    result[out++] = mesh.vertexPosition[id * 3 + 2]
  }
  return result
}
