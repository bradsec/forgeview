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

/**
 * Finish a kept-exterior soup into the best solid the data allows:
 *
 * 1. Weld vertices at a scale-relative tolerance and snap every corner to its
 *    representative, physically closing hairline cracks between faces.
 * 2. Drop degenerate triangles and exact duplicate faces (double walls),
 *    which otherwise register as non-manifold or duplicate geometry.
 * 3. Cap every remaining boundary-edge loop with a centroid fan. Loops left
 *    where hidden interior geometry was cut away sit inside the filled volume
 *    and stay invisible; holes in the original skin become flat caps. Cap
 *    winding follows the surrounding surface.
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
  const vertexPosition: number[] = []
  const cornerId = new Int32Array(triangles * 3)
  for (let corner = 0; corner < triangles * 3; corner++) {
    const offset = corner * 3
    const k = `${Math.round(positions[offset] / quantum)},${Math.round(positions[offset + 1] / quantum)},${Math.round(positions[offset + 2] / quantum)}`
    let id = vertexIds.get(k)
    if (id === undefined) {
      id = vertexIds.size
      vertexIds.set(k, id)
      vertexPosition.push(positions[offset], positions[offset + 1], positions[offset + 2])
    }
    cornerId[corner] = id
  }

  const kept: number[] = []
  const seenFaces = new Set<string>()
  const directed = new Map<number, number>()
  const pack = (a: number, b: number) => a * vertexIds.size + b
  for (let triangle = 0; triangle < triangles; triangle++) {
    const a = cornerId[triangle * 3]
    const b = cornerId[triangle * 3 + 1]
    const c = cornerId[triangle * 3 + 2]
    if (a === b || b === c || c === a) continue
    const face = [a, b, c].sort((x, y) => x - y).join(':')
    if (seenFaces.has(face)) continue
    seenFaces.add(face)
    kept.push(a, b, c)
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      directed.set(pack(u, v), (directed.get(pack(u, v)) ?? 0) + 1)
    }
  }

  // A directed edge used once with no opposite twin lies on the boundary.
  const nextByStart = new Map<number, number[]>()
  for (const [packed, count] of directed) {
    const u = Math.floor(packed / vertexIds.size)
    const v = packed % vertexIds.size
    if (count !== 1 || directed.has(pack(v, u))) continue
    const list = nextByStart.get(u)
    if (list) list.push(v)
    else nextByStart.set(u, [v])
  }

  const capIds: number[] = []
  const capCentroids: number[] = []
  const consumed = new Set<number>()
  for (const [start] of nextByStart) {
    let current = start
    const loop: number[] = []
    // Walk successor edges until the loop closes; bail out on open or tangled
    // chains rather than fabricating geometry.
    for (let steps = 0; steps <= nextByStart.size; steps++) {
      const candidates = nextByStart.get(current)
      const next = candidates?.find((v) => !consumed.has(pack(current, v)))
      if (next === undefined) break
      consumed.add(pack(current, next))
      loop.push(current)
      current = next
      if (current === start) break
    }
    if (current !== start || loop.length < 3) continue
    const centroid = [0, 0, 0]
    for (const id of loop) {
      for (let axis = 0; axis < 3; axis++) centroid[axis] += vertexPosition[id * 3 + axis]
    }
    for (let axis = 0; axis < 3; axis++) centroid[axis] /= loop.length
    const centroidIndex = capCentroids.length / 3
    capCentroids.push(centroid[0], centroid[1], centroid[2])
    for (let i = 0; i < loop.length; i++) {
      // Boundary direction u→v means the missing twin is v→u; the cap
      // triangle (v, u, centroid) supplies it with matching orientation.
      capIds.push(loop[(i + 1) % loop.length], loop[i], centroidIndex)
    }
  }

  const result = new Float32Array(kept.length * 3 + capIds.length * 3)
  let out = 0
  for (const id of kept) {
    result[out++] = vertexPosition[id * 3]
    result[out++] = vertexPosition[id * 3 + 1]
    result[out++] = vertexPosition[id * 3 + 2]
  }
  for (let i = 0; i < capIds.length; i += 3) {
    for (const id of [capIds[i], capIds[i + 1]]) {
      result[out++] = vertexPosition[id * 3]
      result[out++] = vertexPosition[id * 3 + 1]
      result[out++] = vertexPosition[id * 3 + 2]
    }
    const centroid = capIds[i + 2]
    result[out++] = capCentroids[centroid * 3]
    result[out++] = capCentroids[centroid * 3 + 1]
    result[out++] = capCentroids[centroid * 3 + 2]
  }
  return result
}
