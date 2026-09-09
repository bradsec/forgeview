import { expect, test, type Page } from '@playwright/test'

/** Binary-free ASCII STL of an axis-aligned box, every vertex then rotated
 *  `deg` degrees about the X axis, so a thin slab lands clearly tilted. Each
 *  triangle's winding is fixed so its cross-product normal points away from
 *  the box centre (outward), which is what the overhang analysis expects. */
function tiltedBoxStl(w: number, h: number, d: number, deg: number): string {
  const t = (deg * Math.PI) / 180
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  const rot = ([x, y, z]: number[]): [number, number, number] => [
    x,
    y * cos - z * sin,
    y * sin + z * cos,
  ]
  const v = [
    [0, 0, 0], [w, 0, 0], [w, h, 0], [0, h, 0],
    [0, 0, d], [w, 0, d], [w, h, d], [0, h, d],
  ].map(rot)
  const centre = rot([w / 2, h / 2, d / 2])
  const faces = [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
    [0, 5, 1], [0, 4, 5], [1, 6, 2], [1, 5, 6],
    [2, 7, 3], [2, 6, 7], [3, 4, 0], [3, 7, 4],
  ]
  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  const cross = (a: number[], b: number[]) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  let out = 'solid slab\n'
  for (const [i, j, k] of faces) {
    const n = cross(sub(v[j], v[i]), sub(v[k], v[i]))
    const outward = sub(
      [(v[i][0] + v[j][0] + v[k][0]) / 3, (v[i][1] + v[j][1] + v[k][1]) / 3, (v[i][2] + v[j][2] + v[k][2]) / 3],
      centre,
    )
    const order = dot(n, outward) >= 0 ? [i, j, k] : [i, k, j]
    out += 'facet normal 0 0 0\nouter loop\n'
    for (const idx of order) out += `vertex ${v[idx][0]} ${v[idx][1]} ${v[idx][2]}\n`
    out += 'endloop\nendfacet\n'
  }
  return out + 'endsolid slab\n'
}

async function dropStl(page: Page, stl: string, name: string): Promise<void> {
  await page.goto('/')
  await page.evaluate(
    ({ stl, name }) => {
      const file = new File([stl], name, { type: 'model/stl' })
      const dt = new DataTransfer()
      dt.items.add(file)
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    },
    { stl, name }
  )
  await expect(page.getByRole('banner')).toContainText(name)
  await expect(page.getByRole('navigation', { name: 'Camera navigation' })).toBeVisible()
}

test.describe('Auto-orient', () => {
  test('reorients a tilted slab, reports the overhang change, and undoes', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Auto-orient flow verified on desktop')
    test.setTimeout(120_000)

    // 24 wide, 2 thick, 16 long, tilted 35 degrees about X: the tilted
    // underside is a large support-needing overhang, so auto-orient rotates
    // the slab to a flat rest.
    await dropStl(page, tiltedBoxStl(24, 2, 16, 35), 'slab.stl')
    await page.getByRole('button', { name: 'Prepare' }).filter({ visible: true }).click()
    await page.getByRole('button', { name: 'Transform', exact: true, expanded: false }).filter({ visible: true }).click()

    const readout = page.getByTestId('dimensions-readout').filter({ visible: true })
    const rowValue = (label: string) =>
      readout.locator('dt', { hasText: label }).locator('xpath=./following-sibling::dd[1]')
    const undoHistory = () => page.getByTestId('undo-history').filter({ visible: true })

    // Capture a transform-sensitive readout (the model dimensions) so the
    // undo round-trip can be verified. The value itself is not asserted for a
    // specific number (a rotated model's reported box is not tight).
    await page.getByRole('tab', { name: 'Details' }).filter({ visible: true }).click()
    const heightBefore = (await rowValue('Height').textContent())?.trim() ?? ''
    expect(heightBefore).toMatch(/\d/)
    await page.getByRole('tab', { name: 'Prepare' }).filter({ visible: true }).click()
    await page.getByRole('button', { name: 'Transform', exact: true, expanded: false }).filter({ visible: true }).click()

    await page.getByRole('button', { name: 'Auto-orient' }).filter({ visible: true }).click()

    // The result note reports the overhang-area change; this slab has a clear
    // flat rest with no overhang, so the after figure is strictly lower.
    const note = page.getByText(/Overhang area \d+% to \d+%/).filter({ visible: true })
    await expect(note).toBeVisible()
    const m = ((await note.textContent()) ?? '').match(/Overhang area (\d+)% to (\d+)%/)
    expect(Number(m?.[1])).toBeGreaterThan(Number(m?.[2]))

    // The model was reoriented (a transform-sensitive readout changed).
    await page.getByRole('tab', { name: 'Details' }).filter({ visible: true }).click()
    await expect(rowValue('Height')).not.toHaveText(heightBefore)

    // Undo the single "Auto-orient" step restores the prior orientation.
    await page.getByRole('tab', { name: 'Prepare' }).filter({ visible: true }).click()
    await page.getByRole('button', { name: 'Transform', exact: true, expanded: false }).filter({ visible: true }).click()
    await undoHistory().getByRole('button', { name: /Auto-orient/i }).click()
    await page.getByRole('tab', { name: 'Details' }).filter({ visible: true }).click()
    await expect(rowValue('Height')).toHaveText(heightBefore)
  })
})
