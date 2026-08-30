import { expect, test, type Page } from '@playwright/test'

/** ASCII STL of a 20mm cube with the top (+Z) face removed: 10 triangles,
 * 4 open boundary edges, not watertight. Deterministic, no fixture file. */
function openBoxStl(): string {
  const s = 20
  const v = [
    [0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0],
    [0, 0, s], [s, 0, s], [s, s, s], [0, s, s],
  ]
  const tris = [
    [0, 1, 2], [0, 2, 3],
    [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6],
    [3, 0, 4], [3, 4, 7],
  ]
  let out = 'solid box\n'
  for (const [a, b, c] of tris) {
    out += 'facet normal 0 0 0\nouter loop\n'
    for (const i of [a, b, c]) out += `vertex ${v[i][0]} ${v[i][1]} ${v[i][2]}\n`
    out += 'endloop\nendfacet\n'
  }
  return out + 'endsolid box\n'
}

async function dropOpenBox(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate((stl) => {
    const file = new File([stl], 'box.stl', { type: 'model/stl' })
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(file)
    window.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }))
  }, openBoxStl())
  await expect(page.getByRole('banner')).toContainText('box.stl')
  await expect(page.getByRole('navigation', { name: 'Camera navigation' })).toBeVisible()
}

test.describe('Prepare panel', () => {
  test('reports a leak, fixes it with Make solid, and undoes', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Prepare flow verified on desktop')
    test.setTimeout(120_000)

    await dropOpenBox(page)

    // Desktop and mobile sidebars both mount the panel; the mobile one is
    // display:none at this width. Scope every panel locator to what is shown.
    const check = (id: string) => page.getByTestId(`check-${id}`).filter({ visible: true })

    await page.getByRole('button', { name: 'Prepare' }).click()
    const watertight = check('watertight')
    await expect(watertight).toHaveAttribute('data-state', 'fail')
    await expect(check('boundary')).toHaveAttribute('data-state', 'fail')

    await watertight.getByRole('button', { name: 'Fix' }).click()
    const dialog = page.getByRole('dialog', { name: 'Make solid' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Interior detection detail').selectOption('96')
    await dialog.getByRole('button', { name: 'Apply' }).click()
    await expect(dialog.getByRole('definition').first()).toBeVisible({ timeout: 90_000 })
    await dialog.getByRole('button', { name: 'Close' }).click()

    await expect(check('boundary')).toHaveAttribute('data-state', 'pass')

    // Undo history now has exactly one entry for the seal.
    const history = page.getByTestId('undo-history').filter({ visible: true })
    await expect(history.getByRole('button')).toHaveText(['Make solid'])

    // Clicking the entry reverts the seal.
    await history.getByRole('button', { name: /Make solid/ }).click()
    await expect(page.getByTestId('check-boundary').filter({ visible: true }))
      .toHaveAttribute('data-state', 'fail')
    await expect(page.getByTestId('undo-history').filter({ visible: true })).toHaveCount(0)
  })
})
