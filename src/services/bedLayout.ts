export interface LayoutItem {
  id: string
  w: number
  d: number
}

export interface LayoutPlacement {
  id: string
  cx: number
  cz: number
}

export interface BedLayoutResult {
  placements: LayoutPlacement[]
  unplaced: string[]
}

/**
 * Shelf pack: sort by depth then width descending, fill rows left to right
 * within `bed.x`, start a new row (offset on Z by the previous row's tallest
 * footprint plus `gap`) when the next item overflows. An item wider than
 * `bed.x`, or a row that overflows `bed.z`, goes to `unplaced`. The packed
 * block is finally centred on the origin.
 */
export function computeBedLayout(
  items: LayoutItem[],
  bed: { x: number; z: number },
  gap: number,
): BedLayoutResult {
  const sorted = items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => b.it.d - a.it.d || b.it.w - a.it.w || a.i - b.i)
    .map((e) => e.it)

  const raw: { id: string; rx: number; rz: number; w: number; d: number }[] = []
  const unplaced: string[] = []
  let cursorX = 0
  let cursorZ = 0
  let rowMaxD = 0

  for (const it of sorted) {
    if (it.w > bed.x) { unplaced.push(it.id); continue }
    if (cursorX > 0 && cursorX + it.w > bed.x) {
      cursorX = 0
      cursorZ += rowMaxD + gap
      rowMaxD = 0
    }
    if (cursorZ + it.d > bed.z) { unplaced.push(it.id); continue }
    raw.push({ id: it.id, rx: cursorX + it.w / 2, rz: cursorZ + it.d / 2, w: it.w, d: it.d })
    cursorX += it.w + gap
    rowMaxD = Math.max(rowMaxD, it.d)
  }

  if (raw.length === 0) return { placements: [], unplaced }

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const p of raw) {
    minX = Math.min(minX, p.rx - p.w / 2)
    maxX = Math.max(maxX, p.rx + p.w / 2)
    minZ = Math.min(minZ, p.rz - p.d / 2)
    maxZ = Math.max(maxZ, p.rz + p.d / 2)
  }
  const shiftX = -(minX + maxX) / 2
  const shiftZ = -(minZ + maxZ) / 2

  return {
    placements: raw.map((p) => ({ id: p.id, cx: p.rx + shiftX, cz: p.rz + shiftZ })),
    unplaced,
  }
}
