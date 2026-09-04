import { expect, test, type Page } from '@playwright/test'

/** ASCII STL of a single axis-aligned 10mm cube: 12 triangles, watertight.
 * Deterministic, no fixture file. STL carries no unit, so the UnitPrompt appears. */
function cubeStl(): string {
  const s = 10
  const v = [
    [0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0],
    [0, 0, s], [s, 0, s], [s, s, s], [0, s, s],
  ]
  const tris = [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
    [0, 5, 1], [0, 4, 5], [1, 6, 2], [1, 5, 6],
    [2, 7, 3], [2, 6, 7], [3, 4, 0], [3, 7, 4],
  ]
  let out = 'solid cube\n'
  for (const [a, b, c] of tris) {
    out += 'facet normal 0 0 0\nouter loop\n'
    for (const i of [a, b, c]) out += `vertex ${v[i][0]} ${v[i][1]} ${v[i][2]}\n`
    out += 'endloop\nendfacet\n'
  }
  return out + 'endsolid cube\n'
}

async function dropCube(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate((stl) => {
    const file = new File([stl], 'cube.stl', { type: 'model/stl' })
    const dt = new DataTransfer()
    dt.items.add(file)
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, cubeStl())
  await expect(page.getByRole('banner')).toContainText('cube.stl')
  await expect(page.getByRole('navigation', { name: 'Camera navigation' })).toBeVisible()
}

test.describe('SP-3a units + measure', () => {
  test('unit prompt, dimensions, measure, scale, undo', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Units + measure flow verified on desktop')
    test.setTimeout(120_000)

    await dropCube(page)

    // Desktop and mobile sidebars both mount the panel; scope every panel
    // locator to the one that is actually shown at this width.
    const detailsTab = page.getByRole('tab', { name: 'Details' }).filter({ visible: true })
    const prepareTab = page.getByRole('tab', { name: 'Prepare' }).filter({ visible: true })
    const readout = page.getByTestId('dimensions-readout').filter({ visible: true })
    const check = (id: string) => page.getByTestId(`check-${id}`).filter({ visible: true })

    await page.getByRole('button', { name: 'Prepare' }).click()

    // 1. Details tab: the unit prompt and a mm dimensions readout are shown.
    await detailsTab.click()
    await expect(page.getByTestId('unit-prompt').filter({ visible: true })).toBeVisible()
    await expect(readout).toBeVisible()
    await expect(readout).toContainText('mm')

    // 2. Switch the display unit to inches and back.
    await readout.getByRole('button', { name: 'in', exact: true }).click()
    await expect(readout).toContainText('in')
    await readout.getByRole('button', { name: 'mm', exact: true }).click()
    await expect(readout).toContainText('mm')

    // 3. Measure the straight-line distance between two points on the cube.
    await prepareTab.click()
    await page.waitForTimeout(400) // let the load-framing camera move settle
    await page.getByRole('button', { name: 'Measure distance' }).filter({ visible: true }).click()

    const canvas = page.locator('canvas').first()
    const box = (await canvas.boundingBox())!
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5)
    await page.mouse.click(box.x + box.width * 0.58, box.y + box.height * 0.5)

    const measure = page.getByTestId('measure-distance').filter({ visible: true })
    await expect(measure).toBeVisible()
    await expect(measure).toContainText('mm')
    await expect(measure).toHaveText(/[1-9]/)

    await page.getByRole('button', { name: 'Stop measuring' }).filter({ visible: true }).click()

    // 4. Scale the longest edge (10mm) to 100mm: an exact factor of 10.
    const scale = page.locator('#prepare-scale').filter({ visible: true })
    await scale.getByLabel('Target length (mm)').fill('100')
    await scale.getByRole('button', { name: 'Apply' }).click()

    await detailsTab.click()
    await expect(readout).toContainText('100 mm')

    // 5. Undo the scale from the history list: dimensions return to 10mm.
    await prepareTab.click()
    const history = page.getByTestId('undo-history').filter({ visible: true })
    await history.getByRole('button', { name: /Scale to target/i }).click()
    await detailsTab.click()
    await expect(readout).not.toContainText('100 mm')
    await expect(readout).toContainText('10 mm')

    // 6. Shrink the build volume below the cube, then fit to it: the
    // On build plate readiness row flips from fail to pass.
    await prepareTab.click()
    for (const axis of ['x', 'y', 'z'] as const) {
      await scale.getByLabel(`Build volume ${axis}`).fill('5')
    }
    await expect(check('onPlate')).toHaveAttribute('data-state', 'fail')

    await page.getByRole('button', { name: 'Fit to build volume' }).filter({ visible: true }).click()
    await expect(check('onPlate')).toHaveAttribute('data-state', 'pass')
  })
})
