import { expect, test, type Page } from '@playwright/test'

/** A thin slab STL: two parallel triangle layers 0.5 units apart. Assuming
 *  1 unit = 1 mm, both faces sit below the default 1.0 mm minimum wall
 *  (thinWallFaceCount = 2) and above a 0.2 mm minimum (0). Vertices mirror
 *  the wall-thickness unit-test fixture. */
function slabStl(): string {
  const tris = [
    [
      [0, 0, 0],
      [1, 0, 1],
      [1, 0, 0],
    ],
    [
      [0, -0.5, 0],
      [1, -0.5, 0],
      [1, -0.5, 1],
    ],
  ]
  let out = 'solid slab\n'
  for (const tri of tris) {
    out += 'facet normal 0 0 0\nouter loop\n'
    for (const v of tri) out += `vertex ${v[0]} ${v[1]} ${v[2]}\n`
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

test.describe('Wall thickness heatmap', () => {
  test('flags the slab at the default minimum, clears below it, toggles, interlocks, and exports', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Wall thickness flow verified on desktop')
    test.setTimeout(120_000)
    // Force the download-event export path instead of a native file picker,
    // matching e2e/overhang-heatmap.spec.ts's export test.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
    })

    await dropStl(page, slabStl(), 'slab.stl')
    await page.getByRole('button', { name: 'Prepare' }).filter({ visible: true }).click()
    await page.getByRole('button', { name: 'Analysis', exact: true, expanded: false }).filter({ visible: true }).click()

    const check = (id: string) => page.getByTestId(`check-${id}`).filter({ visible: true })

    // Default minimum (1.0 mm): both 0.5 mm slab faces are thin.
    await expect(check('thickness')).toHaveAttribute('data-state', 'warn')
    await expect(check('thickness')).toContainText('2 thin-wall faces')

    // Drop the minimum below the slab thickness: no longer thin.
    const minInput = page.getByLabel('Min wall').filter({ visible: true })
    await minInput.fill('0.2')
    await expect(check('thickness')).toHaveAttribute('data-state', 'pass')
    await expect(check('thickness')).toContainText('0 thin-wall faces')

    // Restore a minimum where the slab is flagged again.
    await minInput.fill('1')
    await expect(check('thickness')).toHaveAttribute('data-state', 'warn')

    // Arm the wall-thickness heatmap.
    const toggle = page.getByRole('button', { name: /wall thickness heatmap/i }).filter({ visible: true })
    await toggle.click()
    await expect(
      page.getByRole('button', { name: 'Hide wall thickness heatmap' }).filter({ visible: true })
    ).toBeVisible()

    // Arming the overhang heatmap disarms this one (three-way interlock).
    await page.getByRole('button', { name: 'Show overhang heatmap' }).filter({ visible: true }).click()
    await expect(
      page.getByRole('button', { name: 'Show wall thickness heatmap' }).filter({ visible: true })
    ).toBeVisible()

    // Re-arm the wall-thickness heatmap and confirm export still succeeds
    // (proves the overlay meshes are excluded from the exported geometry).
    await page.getByRole('button', { name: 'Show wall thickness heatmap' }).filter({ visible: true }).click()
    await expect(
      page.getByRole('button', { name: 'Hide wall thickness heatmap' }).filter({ visible: true })
    ).toBeVisible()
    // C1: the cross-heatmap switch must rebuild a non-empty overlay. No scene
    // introspection hook exists, so assert the readiness row still reads warn
    // right before export; the overlay mesh contents are covered by
    // wallThicknessOverlay.test.ts.
    await expect(check('thickness')).toHaveAttribute('data-state', 'warn')
    await page.getByRole('button', { name: 'File', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Export model as…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Export model' })
    await expect(dialog).toBeVisible()
    const downloadPromise = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Export', exact: true }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('slab.stl')
  })
})
