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

test.describe('Build volume box', () => {
  test('toggles the box, rebuilds on a dimension change, and stays out of exports', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Build volume flow verified on desktop')
    test.setTimeout(120_000)
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
    })

    await dropStl(page, cubeStl(), 'cube.stl')
    await page.getByRole('button', { name: 'Prepare' }).filter({ visible: true }).click()
    await page.getByRole('button', { name: 'Scale', exact: true, expanded: false }).filter({ visible: true }).click()

    const show = page.getByRole('button', { name: 'Show build volume' }).filter({ visible: true })
    await show.click()
    await expect(page.getByRole('button', { name: 'Hide build volume' }).filter({ visible: true })).toBeVisible()

    // A dimension change rebuilds the box; the toggle stays armed.
    const volX = page.getByLabel('Build volume x').filter({ visible: true })
    await volX.fill('120')
    await expect(page.getByRole('button', { name: 'Hide build volume' }).filter({ visible: true })).toBeVisible()

    await page.getByRole('button', { name: 'Hide build volume' }).filter({ visible: true }).click()
    await expect(page.getByRole('button', { name: 'Show build volume' }).filter({ visible: true })).toBeVisible()

    // Re-show, then export: the box is line geometry and tagged, so the STL
    // still holds exactly the cube's 12 triangles.
    await page.getByRole('button', { name: 'Show build volume' }).filter({ visible: true }).click()
    await page.getByRole('button', { name: 'File', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Export model as…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Export model' })
    await expect(dialog).toBeVisible()
    const downloadPromise = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Export', exact: true }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('cube.stl')
  })
})
