import { expect, test, type Page } from '@playwright/test'

/** ASCII STL of an axis-aligned box: width=20 (X), height=10 (Y), depth=5 (Z).
 *  Deliberately non-cube so a 90-degree rotation about X visibly swaps the
 *  Height/Depth readout. */
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
  await page.evaluate(({ stl, name }) => {
    const file = new File([stl], name, { type: 'model/stl' })
    const dt = new DataTransfer()
    dt.items.add(file)
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, { stl, name })
  await expect(page.getByRole('banner')).toContainText(name)
  await expect(page.getByRole('navigation', { name: 'Camera navigation' })).toBeVisible()
}

test.describe('Transform panel', () => {
  test('moves, rotates, scales, mirrors, drops to floor, and centers, each undoable', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Transform flow verified on desktop')
    test.setTimeout(120_000)

    await dropStl(page, boxStl(20, 10, 5), 'box.stl')

    const readout = page.getByTestId('dimensions-readout').filter({ visible: true })
    // DimensionsReadout renders each row as <div><dt>Label</dt><dd>value</dd></div>
    // (verified against src/components/prepare/DimensionsReadout.tsx), so a dt's
    // dd is its own next sibling within the same parent. Playwright resolves a
    // relative xpath from the prior locator's matched element as context node;
    // a leading "." is not required but is included for clarity/portability.
    const rowValue = (label: string) =>
      readout.locator('dt', { hasText: label }).locator('xpath=./following-sibling::dd[1]')
    const undoHistory = () => page.getByTestId('undo-history').filter({ visible: true })
    const undoAndCheckGone = async (label: string) => {
      await undoHistory().getByRole('button', { name: new RegExp(label, 'i') }).click()
      await expect(page.getByTestId('undo-history').filter({ visible: true })).toHaveCount(0)
    }

    // Open the sidebar and select the Prepare tab (SP-1's single toolbar
    // control); the sidebar's own Details/Prepare tab strip (role="tab")
    // is then used for every further switch.
    await page.getByRole('button', { name: 'Prepare' }).filter({ visible: true }).click()
    await page.getByRole('button', { name: 'Transform', exact: true, expanded: false }).filter({ visible: true }).click()

    // Baseline dimensions before any transform.
    await page.getByRole('tab', { name: 'Details' }).filter({ visible: true }).click()
    await expect(rowValue('Width')).toHaveText('20 mm')
    await expect(rowValue('Height')).toHaveText('10 mm')
    await expect(rowValue('Depth')).toHaveText('5 mm')
    await page.getByRole('tab', { name: 'Prepare' }).filter({ visible: true }).click()
    await page.getByRole('button', { name: 'Transform', exact: true, expanded: false }).filter({ visible: true }).click()

    // Move: no dimension readout can confirm displacement; the undo entry
    // proves moveModelBy ran and pushed an edit.
    await page.getByLabel('Move x').filter({ visible: true }).fill('5')
    await page.getByRole('button', { name: 'Apply move' }).filter({ visible: true }).click()
    await expect(undoHistory().getByRole('button')).toHaveText(['Move'])
    await undoAndCheckGone('Move')

    // Rotate 90 deg about X swaps Height and Depth (10 <-> 5).
    await page.getByLabel('Rotate x').filter({ visible: true }).fill('90')
    await page.getByRole('button', { name: 'Apply rotate' }).filter({ visible: true }).click()
    await expect(undoHistory().getByRole('button')).toHaveText(['Rotate'])
    await page.getByRole('tab', { name: 'Details' }).filter({ visible: true }).click()
    await expect(rowValue('Height')).toHaveText('5 mm')
    await expect(rowValue('Depth')).toHaveText('10 mm')
    await page.getByRole('tab', { name: 'Prepare' }).filter({ visible: true }).click()
    await page.getByRole('button', { name: 'Transform', exact: true, expanded: false }).filter({ visible: true }).click()
    await undoAndCheckGone('Rotate')
    await page.getByRole('tab', { name: 'Details' }).filter({ visible: true }).click()
    await expect(rowValue('Height')).toHaveText('10 mm')
    await expect(rowValue('Depth')).toHaveText('5 mm')
    await page.getByRole('tab', { name: 'Prepare' }).filter({ visible: true }).click()
    await page.getByRole('button', { name: 'Transform', exact: true, expanded: false }).filter({ visible: true }).click()

    // Free scale Y x2 doubles the Height reading only (10 -> 20).
    await page.getByLabel('Scale (free) y').filter({ visible: true }).fill('2')
    await page.getByRole('button', { name: 'Apply scale' }).filter({ visible: true }).click()
    await expect(undoHistory().getByRole('button')).toHaveText(['Scale (free)'])
    await page.getByRole('tab', { name: 'Details' }).filter({ visible: true }).click()
    await expect(rowValue('Height')).toHaveText('20 mm')
    await expect(rowValue('Width')).toHaveText('20 mm') // unchanged, still 20
    await page.getByRole('tab', { name: 'Prepare' }).filter({ visible: true }).click()
    await page.getByRole('button', { name: 'Transform', exact: true, expanded: false }).filter({ visible: true }).click()
    await undoAndCheckGone('Scale')
    await page.getByRole('tab', { name: 'Details' }).filter({ visible: true }).click()
    await expect(rowValue('Height')).toHaveText('10 mm')
    await page.getByRole('tab', { name: 'Prepare' }).filter({ visible: true }).click()
    await page.getByRole('button', { name: 'Transform', exact: true, expanded: false }).filter({ visible: true }).click()

    // Mirror X: dimensions unchanged, undo entry is the signal.
    await page.getByRole('button', { name: 'Mirror X' }).filter({ visible: true }).click()
    await expect(undoHistory().getByRole('button')).toHaveText(['Mirror X'])
    await undoAndCheckGone('Mirror X')

    // Drop to floor / Center on plate: no readout to check, undo entry is the signal.
    await page.getByRole('button', { name: 'Drop to floor' }).filter({ visible: true }).click()
    await expect(undoHistory().getByRole('button')).toHaveText(['Drop to floor'])
    await undoAndCheckGone('Drop to floor')

    await page.getByRole('button', { name: 'Center on plate' }).filter({ visible: true }).click()
    await expect(undoHistory().getByRole('button')).toHaveText(['Center on plate'])
    await undoAndCheckGone('Center on plate')
  })
})
