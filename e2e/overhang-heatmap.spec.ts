import { expect, test, type Page } from '@playwright/test'

/** A flat plate rotated 30 deg about X from straight-down-facing, so its
 *  face normal sits exactly 30 deg from straight down. See the design spec
 *  and overhangAnalysis.test.ts for the derivation. Both triangles share
 *  the same face plane. */
function rampPlateStl(): string {
  const p0 = [0, 0, 0]
  const p1 = [20, 0, 0]
  const p2 = [20, -5, 8.660254]
  const p3 = [0, -5, 8.660254]
  const tris = [
    [p0, p1, p2],
    [p0, p2, p3],
  ]
  let out = 'solid ramp\n'
  for (const tri of tris) {
    out += 'facet normal 0 0 0\nouter loop\n'
    for (const v of tri) out += `vertex ${v[0]} ${v[1]} ${v[2]}\n`
    out += 'endloop\nendfacet\n'
  }
  return out + 'endsolid ramp\n'
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

test.describe('Overhang heatmap', () => {
  test('flags the ramp at the default threshold, clears below its angle, toggles, and exports', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Overhang heatmap flow verified on desktop')
    test.setTimeout(120_000)
    // Force the download-event export path instead of a native file picker,
    // matching e2e/model-workflows.spec.ts's export test.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
    })

    await dropStl(page, rampPlateStl(), 'ramp.stl')
    await page.getByRole('button', { name: 'Prepare' }).filter({ visible: true }).click()

    const check = (id: string) => page.getByTestId(`check-${id}`).filter({ visible: true })

    // Default threshold (45): the 30-deg ramp face is an overhang.
    await expect(check('overhangs')).toHaveAttribute('data-state', 'warn')
    await expect(check('overhangs')).toContainText('2 overhang faces')

    // Lower the threshold below the ramp's angle: no longer an overhang.
    const thresholdInput = page.getByLabel('Overhang angle').filter({ visible: true })
    await thresholdInput.fill('15')
    await expect(check('overhangs')).toHaveAttribute('data-state', 'pass')
    await expect(check('overhangs')).toContainText('0 overhang faces')

    // Restore the default so the heatmap toggle below is exercised at a
    // threshold where the ramp is actually flagged.
    await thresholdInput.fill('45')
    await expect(check('overhangs')).toHaveAttribute('data-state', 'warn')

    // Toggle the heatmap on and off without error.
    const toggle = page.getByRole('button', { name: /overhang heatmap/i }).filter({ visible: true })
    await toggle.click()
    await expect(
      page.getByRole('button', { name: 'Hide overhang heatmap' }).filter({ visible: true })
    ).toBeVisible()
    await toggle.click()
    await expect(
      page.getByRole('button', { name: 'Show overhang heatmap' }).filter({ visible: true })
    ).toBeVisible()

    // Arm it again and confirm export still succeeds (proves the
    // userData.overhangOverlay exclusion tag works end to end).
    await toggle.click()
    await page.getByRole('button', { name: 'File', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Export model as…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Export model' })
    await expect(dialog).toBeVisible()
    const downloadPromise = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Export', exact: true }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('ramp.stl')
  })
})
