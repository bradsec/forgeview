export const MAX_REMESH_TRIANGLES = 5_000_000

export function remeshInputError(triangles: number): string | null {
  if (!Number.isInteger(triangles) || triangles < 4) return 'Decimate / remesh requires at least 4 complete triangles.'
  if (triangles > MAX_REMESH_TRIANGLES) return `This mesh has ${triangles.toLocaleString()} triangles. Decimate / remesh supports up to ${MAX_REMESH_TRIANGLES.toLocaleString()}.`
  return null
}
