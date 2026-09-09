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
  progress: (percent: number, phase: string) => void = () => {},
  gpuAssisted = true,
  /**
   * Override the reachable-surface dilation, in voxel steps. Strip-internal-walls
   * mode passes 1 (mark only skin voxels directly on outside air) so that walls
   * one voxel behind the skin classify as interior; the GPU visibility pass then
   * rescues anything genuinely seen from outside.
   */
  dilationOverride?: number
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
  // surface so triangle classification is a single lookup. The dilation is a
  // safety margin so detail recessed just behind the outermost surface voxels
  // (grooves, creases, panel gaps) stays kept instead of being treated as
  // interior. Its reach is a fixed fraction of the model span, not a fixed
  // voxel count, so a finer detection grid does not silently trim more
  // recessed detail than a coarse one. Without the GPU visibility pass to
  // rescue narrow-gap surfaces, widen the margin further.
  const spanVoxels = resolution - 6
  const dilationPasses = dilationOverride ?? Math.max(
    2,
    Math.round((gpuAssisted ? 0.0165 : 0.045) * spanVoxels)
  )
  progress(60, 'Marking reachable surface')
  let reachable = outside
  for (let pass = 0; pass < dilationPasses; pass++) {
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
 * Keep the exterior skin whole. The voxel flood decides keep/drop per triangle
 * with no regard for connectivity, so it can drop a triangle that is part of
 * the same surface sheet as its kept neighbours (a thin wall, a fold), which
 * tears a slit in the skin that later shows as a flat-bottomed gash after
 * capping. Regrow any dropped triangle that shares a manifold edge (exactly two
 * incident triangles) with a kept one, since a shared manifold edge means they
 * are literally the same sheet. Internal partitions meet the skin at
 * non-manifold edges and stay dropped; fully detached interior shells share no
 * edge with the skin and stay dropped. `flags` is mutated in place.
 */
export function protectConnectedSkin(positions: Float32Array, flags: Uint8Array): void {
  const triangles = flags.length
  if (triangles === 0) return

  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
    bounds[axis] = Math.min(bounds[axis], positions[i + axis])
    bounds[axis + 3] = Math.max(bounds[axis + 3], positions[i + axis])
  }
  const diagonal = Math.hypot(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2])
  const quantum = Math.max(diagonal * 1e-6, 1e-9)

  const vertexIds = new Map<string, number>()
  const cornerId = new Int32Array(triangles * 3)
  for (let corner = 0; corner < triangles * 3; corner++) {
    const o = corner * 3
    const key = `${Math.round(positions[o] / quantum)},${Math.round(positions[o + 1] / quantum)},${Math.round(positions[o + 2] / quantum)}`
    let id = vertexIds.get(key)
    if (id === undefined) {
      id = vertexIds.size
      vertexIds.set(key, id)
    }
    cornerId[corner] = id
  }

  const stride = vertexIds.size + 1
  const edgeTris = new Map<number, number[]>()
  const edgesOf = (triangle: number): [number, number, number] => {
    const a = cornerId[triangle * 3]
    const b = cornerId[triangle * 3 + 1]
    const c = cornerId[triangle * 3 + 2]
    return [
      a < b ? a * stride + b : b * stride + a,
      b < c ? b * stride + c : c * stride + b,
      c < a ? c * stride + a : a * stride + c,
    ]
  }
  for (let triangle = 0; triangle < triangles; triangle++) {
    for (const edge of edgesOf(triangle)) {
      const list = edgeTris.get(edge)
      if (list) list.push(triangle)
      else edgeTris.set(edge, [triangle])
    }
  }

  // BFS keep-ness across manifold edges into dropped triangles.
  const queue: number[] = []
  for (let triangle = 0; triangle < triangles; triangle++) {
    if (!flags[triangle]) continue
    for (const edge of edgesOf(triangle)) {
      const list = edgeTris.get(edge)!
      if (list.length !== 2) continue
      const other = list[0] === triangle ? list[1] : list[0]
      if (!flags[other]) queue.push(other)
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const triangle = queue[head]
    if (flags[triangle]) continue
    flags[triangle] = 1
    for (const edge of edgesOf(triangle)) {
      const list = edgeTris.get(edge)!
      if (list.length !== 2) continue
      const other = list[0] === triangle ? list[1] : list[0]
      if (!flags[other]) queue.push(other)
    }
  }
}

interface SolidMesh {
  /** xyz per vertex id; cap centroids are appended as new ids. */
  vertexPosition: number[]
  /** vertex-id triples, winding preserved from the source soup. */
  faces: number[]
  /** Reused until a face or vertex id changes. All topology edits invalidate it. */
  boundary?: Array<[number, number]>
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
  mesh.boundary = undefined
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
  if (mesh.boundary) return mesh.boundary
  const stride = mesh.vertexPosition.length / 3 + 1
  const directed = buildDirectedEdges(mesh)
  const boundary: Array<[number, number]> = []
  for (const [packed, count] of directed) {
    const u = Math.floor(packed / stride)
    const v = packed % stride
    if (count === 1 && !directed.has(v * stride + u)) boundary.push([u, v])
  }
  mesh.boundary = boundary
  return boundary
}

/**
 * Fan a closed ring of vertex ids to their centroid, reversed so each
 * perimeter edge ring[i]->ring[i+1] gets its missing twin ring[i+1]->ring[i].
 * Guarantees closure for any ring; used as the fallback when ear clipping
 * cannot resolve a tangled or non-planar loop.
 */
function centroidFan(mesh: SolidMesh, ring: number[]): void {
  const pos = mesh.vertexPosition
  const m = ring.length
  if (m < 3) return
  mesh.boundary = undefined
  const centroid = [0, 0, 0]
  for (const id of ring) for (let axis = 0; axis < 3; axis++) centroid[axis] += pos[id * 3 + axis]
  const centroidId = pos.length / 3
  pos.push(centroid[0] / m, centroid[1] / m, centroid[2] / m)
  for (let i = 0; i < m; i++) mesh.faces.push(ring[(i + 1) % m], ring[i], centroidId)
}

/**
 * Triangulate one closed boundary ring and append the cap faces. The ring is
 * walked in boundary-edge direction, so every perimeter edge loop[i]->loop[i+1]
 * needs its missing twin loop[i+1]->loop[i]; each cap triangle is emitted in
 * reversed vertex order so its perimeter edges supply exactly those twins.
 *
 * Ear clipping in the ring's best-fit plane keeps caps flat against the
 * surrounding surface instead of tenting to an off-surface centroid, which is
 * what made large concave junction openings look like jagged webs. Whatever
 * ear clipping cannot resolve (non-planar, self-overlapping, or tangled
 * remainders) is closed by {@link centroidFan}, so the ring always ends closed.
 */
function fillLoop(mesh: SolidMesh, loop: number[]): void {
  const pos = mesh.vertexPosition
  const n = loop.length
  if (n < 3) return
  mesh.boundary = undefined
  if (n === 3) {
    mesh.faces.push(loop[2], loop[1], loop[0])
    return
  }

  // Newell normal of the ring.
  let nx = 0
  let ny = 0
  let nz = 0
  for (let i = 0; i < n; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % n]
    nx += (pos[a * 3 + 1] - pos[b * 3 + 1]) * (pos[a * 3 + 2] + pos[b * 3 + 2])
    ny += (pos[a * 3 + 2] - pos[b * 3 + 2]) * (pos[a * 3] + pos[b * 3])
    nz += (pos[a * 3] - pos[b * 3]) * (pos[a * 3 + 1] + pos[b * 3 + 1])
  }
  const nlen = Math.hypot(nx, ny, nz)
  if (nlen === 0) {
    centroidFan(mesh, loop)
    return
  }
  nx /= nlen
  ny /= nlen
  nz /= nlen
  // Plane basis: u from the axis least aligned with the normal, v = n x u.
  const ax = Math.abs(nx)
  const ay = Math.abs(ny)
  const az = Math.abs(nz)
  let ux = 0
  let uy = 0
  let uz = 0
  if (ax <= ay && ax <= az) ux = 1
  else if (ay <= az) uy = 1
  else uz = 1
  const dot = ux * nx + uy * ny + uz * nz
  ux -= dot * nx
  uy -= dot * ny
  uz -= dot * nz
  const ulen = Math.hypot(ux, uy, uz) || 1
  ux /= ulen
  uy /= ulen
  uz /= ulen
  const vx = ny * uz - nz * uy
  const vy = nz * ux - nx * uz
  const vz = nx * uy - ny * ux
  const px: number[] = new Array(n)
  const py: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const id = loop[i]
    px[i] = pos[id * 3] * ux + pos[id * 3 + 1] * uy + pos[id * 3 + 2] * uz
    py[i] = pos[id * 3] * vx + pos[id * 3 + 1] * vy + pos[id * 3 + 2] * vz
  }
  let signedArea = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    signedArea += px[i] * py[j] - px[j] * py[i]
  }
  if (signedArea <= 0) {
    // Ring winds the other way in this basis, or is self-overlapping: the
    // ear-clip convexity test would be inverted. Fan instead.
    centroidFan(mesh, loop)
    return
  }

  const idx: number[] = Array.from({ length: n }, (_, i) => i)
  const isConvex = (a: number, b: number, c: number) =>
    (px[b] - px[a]) * (py[c] - py[a]) - (py[b] - py[a]) * (px[c] - px[a]) > 0
  const inside = (a: number, b: number, c: number, p: number) => {
    const d1 = (px[a] - px[p]) * (py[b] - py[p]) - (px[b] - px[p]) * (py[a] - py[p])
    const d2 = (px[b] - px[p]) * (py[c] - py[p]) - (px[c] - px[p]) * (py[b] - py[p])
    const d3 = (px[c] - px[p]) * (py[a] - py[p]) - (px[a] - px[p]) * (py[c] - py[p])
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0
    return !(hasNeg && hasPos)
  }
  let guard = idx.length * idx.length + 8
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i - 1 + idx.length) % idx.length]
      const b = idx[i]
      const c = idx[(i + 1) % idx.length]
      if (!isConvex(a, b, c)) continue
      let blocked = false
      for (let k = 0; k < idx.length; k++) {
        const p = idx[k]
        if (p === a || p === b || p === c) continue
        if (inside(a, b, c, p)) {
          blocked = true
          break
        }
      }
      if (blocked) continue
      mesh.faces.push(loop[c], loop[b], loop[a])
      idx.splice(i, 1)
      clipped = true
      break
    }
    if (!clipped) break
  }
  if (idx.length === 3) {
    mesh.faces.push(loop[idx[2]], loop[idx[1]], loop[idx[0]])
  } else if (idx.length > 3) {
    // Ear clipping stalled on a tangled remainder: close it with a fan. The
    // chord ear clipping left between the resolved part and this remainder is
    // shared, so both orientations of it are present and the ring stays closed.
    centroidFan(mesh, idx.map((i) => loop[i]))
  }
}

/**
 * Cap boundary-edge loops. Chains follow the most geometrically continuous
 * outgoing edge at junction vertices (a figure-8 then splits into two clean
 * loops instead of one broken walk), and a walk that cannot close releases its
 * edges for later walks. Each closed ring is triangulated by {@link fillLoop}.
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
    fillLoop(mesh, loop)
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
  mesh.boundary = undefined
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
 * Terminal closure. Collapse each connected component of remaining boundary
 * edges whose extent is under `maxSpan` to a single point: every edge in it
 * becomes degenerate and dedupeFaces drops it, so the tangled opening is
 * stitched shut. Only open-edge rim vertices move, and only across sub-`maxSpan`
 * distances, so the visible surface holds. Returns whether anything welded.
 */
function weldBoundaryComponents(mesh: SolidMesh, maxSpan: number): boolean {
  const boundary = boundaryEdgeList(mesh)
  if (boundary.length === 0) return false
  const pos = mesh.vertexPosition
  const parent = new Map<number, number>()
  const root = (id: number): number => {
    let r = id
    while (parent.get(r) !== r) r = parent.get(r)!
    while (parent.get(id) !== r) {
      const next = parent.get(id)!
      parent.set(id, r)
      id = next
    }
    return r
  }
  for (const [u, v] of boundary) {
    if (!parent.has(u)) parent.set(u, u)
    if (!parent.has(v)) parent.set(v, v)
    parent.set(root(u), root(v))
  }
  const members = new Map<number, number[]>()
  for (const id of parent.keys()) {
    const r = root(id)
    const list = members.get(r)
    if (list) list.push(id)
    else members.set(r, [id])
  }
  const remap = new Map<number, number>()
  for (const ids of members.values()) {
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    const sum = [0, 0, 0]
    for (const id of ids) for (let axis = 0; axis < 3; axis++) {
      const value = pos[id * 3 + axis]
      lo[axis] = Math.min(lo[axis], value)
      hi[axis] = Math.max(hi[axis], value)
      sum[axis] += value
    }
    if (Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) > maxSpan) continue
    const keep = ids[0]
    for (let axis = 0; axis < 3; axis++) pos[keep * 3 + axis] = sum[axis] / ids.length
    for (const id of ids) if (id !== keep) remap.set(id, keep)
  }
  if (remap.size === 0) return false
  for (let i = 0; i < mesh.faces.length; i++) {
    const mapped = remap.get(mesh.faces[i])
    if (mapped !== undefined) mesh.faces[i] = mapped
  }
  dedupeFaces(mesh)
  return true
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
export function finalizeSolid(
  positions: Float32Array,
  progress: (phase: string) => void = () => {},
): Float32Array {
  const triangles = Math.floor(positions.length / 9)
  if (triangles === 0) return positions

  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
    bounds[axis] = Math.min(bounds[axis], positions[i + axis])
    bounds[axis + 3] = Math.max(bounds[axis + 3], positions[i + axis])
  }
  const diagonal = Math.hypot(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2])
  const quantum = Math.max(diagonal * 1e-5, 1e-9)

  progress('Welding vertices')
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

  progress('Removing duplicate and collapsed faces')
  dedupeFaces(mesh)
  progress('Sealing boundary loops')
  capBoundaryLoops(mesh)
  for (const factor of [20, 100, 500, 2500]) {
    if (boundaryEdgeList(mesh).length === 0) break
    progress('Closing cracks')
    snapBoundaryVertices(mesh, quantum * factor)
    capBoundaryLoops(mesh)
  }
  // Terminal closure: alternately fan any residual boundary and weld the small
  // tangled components that fan spokes leave single-sided, until nothing is
  // open. Both steps only touch open-edge rim vertices, so the visible surface
  // holds. Widen the weld if fan+weld alone stops converging.
  let open = boundaryEdgeList(mesh).length
  for (let round = 0; round < 40 && open > 0; round++) {
    progress(`Sealing remaining openings: pass ${round + 1}`)
    capRemainingBoundary(mesh)
    weldBoundaryComponents(mesh, diagonal * 0.02)
    dedupeFaces(mesh)
    const next = boundaryEdgeList(mesh).length
    if (next > 0 && next >= open && round > 3) {
      weldBoundaryComponents(mesh, diagonal * 0.04)
      dedupeFaces(mesh)
    }
    open = boundaryEdgeList(mesh).length
  }

  const result = new Float32Array(mesh.faces.length * 3)
  let out = 0
  for (const id of mesh.faces) {
    result[out++] = mesh.vertexPosition[id * 3]
    result[out++] = mesh.vertexPosition[id * 3 + 1]
    result[out++] = mesh.vertexPosition[id * 3 + 2]
  }
  return result
}
