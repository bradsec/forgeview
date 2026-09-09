import { expect, test, type Page } from '@playwright/test'

function cubeStl(): string {
  const v = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ]
  const faces = [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2],
    [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0],
  ]
  let out = 'solid cube\n'
  for (const f of faces) {
    out += 'facet normal 0 0 0\nouter loop\n'
    for (const i of f) out += `vertex ${v[i][0]} ${v[i][1]} ${v[i][2]}\n`
    out += 'endloop\nendfacet\n'
  }
  return out + 'endsolid cube\n'
}

/** ASCII STL of two axis-aligned 10mm cubes, the second offset +30 on X:
 *  one solid, two disconnected shells, so Split by shell yields two parts. */
function twoCubesStl(): string {
  const cube = (ox: number) => {
    const s = 10
    const v = [
      [ox, 0, 0], [ox + s, 0, 0], [ox + s, s, 0], [ox, s, 0],
      [ox, 0, s], [ox + s, 0, s], [ox + s, s, s], [ox, s, s],
    ]
    const tris = [
      [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
      [0, 5, 1], [0, 4, 5], [1, 6, 2], [1, 5, 6],
      [2, 7, 3], [2, 6, 7], [3, 4, 0], [3, 7, 4],
    ]
    let out = ''
    for (const [a, b, c] of tris) {
      out += 'facet normal 0 0 0\nouter loop\n'
      for (const i of [a, b, c]) out += `vertex ${v[i][0]} ${v[i][1]} ${v[i][2]}\n`
      out += 'endloop\nendfacet\n'
    }
    return out
  }
  return `solid two\n${cube(0)}${cube(30)}endsolid two\n`
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

test.describe('X-ray and clip plane', () => {
  test('toggles x-ray and clip, adjusts the plane, interlocks with a heatmap, and exports', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Inspect flow verified on desktop')
    test.setTimeout(120_000)
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
    })

    await dropStl(page, cubeStl(), 'cube.stl')
    await page.getByRole('button', { name: 'Prepare' }).filter({ visible: true }).click()
    await page.getByRole('button', { name: 'Analysis', exact: true, expanded: false }).filter({ visible: true }).click()

    const xrayShow = page.getByRole('button', { name: 'Show X-ray' }).filter({ visible: true })
    const clipShow = page.getByRole('button', { name: 'Show clip plane' }).filter({ visible: true })

    await xrayShow.click()
    await expect(page.getByRole('button', { name: 'Hide X-ray' }).filter({ visible: true })).toBeVisible()

    await clipShow.click()
    await expect(
      page.getByRole('button', { name: 'Hide clip plane' }).filter({ visible: true })
    ).toBeVisible()
    const pos = page.getByLabel('Clip position').filter({ visible: true })
    await expect(pos).toBeVisible()
    await expect(page.getByRole('button', { name: 'X', exact: true }).filter({ visible: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Y', exact: true }).filter({ visible: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Z', exact: true }).filter({ visible: true })).toBeVisible()

    await pos.fill('0.25')
    await page.getByRole('button', { name: 'X', exact: true }).filter({ visible: true }).click()
    await page.getByRole('button', { name: 'Flip side' }).filter({ visible: true }).click()
    await expect(
      page.getByRole('button', { name: 'Hide clip plane' }).filter({ visible: true })
    ).toBeVisible()

    // Arming a heatmap disarms both inspect aids (interlock).
    await page.getByRole('button', { name: 'Show overhang heatmap' }).filter({ visible: true }).click()
    await expect(page.getByRole('button', { name: 'Show X-ray' }).filter({ visible: true })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Show clip plane' }).filter({ visible: true })
    ).toBeVisible()

    // Re-arm x-ray, export.
    await page.getByRole('button', { name: 'Show X-ray' }).filter({ visible: true }).click()
    await expect(page.getByRole('button', { name: 'Hide X-ray' }).filter({ visible: true })).toBeVisible()
    await page.getByRole('button', { name: 'File', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Export model as…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Export model' })
    await expect(dialog).toBeVisible()
    const downloadPromise = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Export', exact: true }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('cube.stl')

    // I2: the export disarms X-ray around collectExportMeshes and re-arms it in
    // finally, so the toggle is back to "Hide X-ray" once the download resolves.
    await expect(page.getByRole('button', { name: 'Hide X-ray' }).filter({ visible: true })).toBeVisible()
  })

  test('split by shell auto-disarms an armed x-ray', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Inspect flow verified on desktop')
    test.setTimeout(120_000)

    await dropStl(page, twoCubesStl(), 'two.stl')
    await page.getByRole('button', { name: 'Prepare' }).filter({ visible: true }).click()
    await page.getByRole('button', { name: 'Analysis', exact: true, expanded: false }).filter({ visible: true }).click()

    await page.getByRole('button', { name: 'Show X-ray' }).filter({ visible: true }).click()
    await expect(page.getByRole('button', { name: 'Hide X-ray' }).filter({ visible: true })).toBeVisible()

    await page.getByRole('button', { name: 'Split', exact: true, expanded: false }).filter({ visible: true }).click()
    const splitBtn = page.getByRole('button', { name: 'Split by shell', exact: true }).filter({ visible: true })
    await expect(splitBtn).toBeEnabled()
    await splitBtn.click()

    await expect(page.getByTestId('split-parts').filter({ visible: true }).getByRole('listitem')).toHaveCount(2)
    // C1: the split restores and disarms X-ray before cloning the part
    // materials, so the toggle is back to "Show X-ray".
    await expect(page.getByRole('button', { name: 'Show X-ray' }).filter({ visible: true })).toBeVisible()
  })
})
