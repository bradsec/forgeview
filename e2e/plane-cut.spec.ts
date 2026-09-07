import { expect, test, type Page } from '@playwright/test'

/** ASCII STL of an axis-aligned box (corner at the origin), outward winding. */
function boxStl(w: number, h: number, d: number): string {
  const v = [
    [0, 0, 0], [w, 0, 0], [w, h, 0], [0, h, 0],
    [0, 0, d], [w, 0, d], [w, h, d], [0, h, d],
  ]
  const tris = [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
    [0, 5, 1], [0, 4, 5], [1, 6, 2], [1, 5, 6],
    [2, 7, 3], [2, 6, 7], [3, 4, 0], [3, 7, 4],
  ]
  let out = 'solid box\n'
  for (const [a, b, c] of tris) {
    out += 'facet normal 0 0 0\nouter loop\n'
    for (const i of [a, b, c]) out += `vertex ${v[i][0]} ${v[i][1]} ${v[i][2]}\n`
    out += 'endloop\nendfacet\n'
  }
  return out + 'endsolid box\n'
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

test.describe('Plane cut', () => {
  test('slices a box into two parts along the clip plane and undoes', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Plane cut flow verified on desktop')
    test.setTimeout(120_000)

    await dropStl(page, boxStl(40, 30, 40), 'box.stl')
    await page.getByRole('button', { name: 'Prepare' }).filter({ visible: true }).click()

    await page.getByRole('button', { name: 'Show clip plane' }).filter({ visible: true }).click()
    const pos = page.getByLabel('Clip position').filter({ visible: true })
    await expect(pos).toBeVisible()
    await pos.fill('0.5')

    const cutBtn = page.getByRole('button', { name: 'Cut at plane' }).filter({ visible: true })
    await expect(cutBtn).toBeEnabled()
    await cutBtn.click()

    // The first cut pays the one-off manifold wasm init; the parts list is the
    // completion signal (no arbitrary wait).
    const partRows = page.getByTestId('split-parts').filter({ visible: true }).getByRole('listitem')
    await expect(partRows).toHaveCount(2, { timeout: 60_000 })
    // A successful cut disarms the clip plane, so the "Cut at plane" control
    // (which lives in the clip block) unmounts.
    await expect(page.getByRole('button', { name: 'Cut at plane' })).toHaveCount(0)

    const undoHistory = page.getByTestId('undo-history').filter({ visible: true })
    await undoHistory.getByRole('button', { name: /Plane cut/i }).click()
    await expect(page.getByTestId('split-parts').filter({ visible: true })).toHaveCount(0)
  })
})
