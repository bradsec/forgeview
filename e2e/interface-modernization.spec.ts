import { expect, test, type Page } from '@playwright/test'

async function openModel(page: Page) {
  await page.goto('/')
  const stl = 'solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 20 0 0\nvertex 0 20 0\nendloop\nendfacet\nendsolid triangle'
  await page.evaluate((source) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([source], 'interface-test.stl', { type: 'model/stl' }))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  }, stl)
  await expect(page.getByRole('navigation', { name: 'Camera navigation' })).toBeVisible()
}

async function openPrepare(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    await page.getByRole('button', { name: 'View', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Prepare', exact: true }).click()
  } else await page.getByRole('button', { name: 'Prepare', exact: true }).click()
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 640 }, { width: 320, height: 568 }]) {
  test(`Repair actions remain reachable at ${viewport.width} x ${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await openModel(page)
    await openPrepare(page)
    const trigger = page.getByRole('button', { name: 'Repair…', exact: true }).filter({ visible: true })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Repair', exact: true })
    await expect(dialog).toBeVisible()
    for (const locator of [dialog, dialog.getByRole('button', { name: 'Close', exact: true }), dialog.getByRole('button', { name: 'Repair all', exact: true })]) {
      const box = await locator.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
    }
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })
}

test('export keeps keyboard focus and selected units inside its modal', async ({ page }) => {
  await openModel(page)
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Export model as…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export model', exact: true })
  await dialog.getByRole('radio', { name: /3MF/ }).check()
  const units = dialog.getByRole('combobox', { name: '3MF units' })
  await units.focus()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(units).toBeFocused()
  expect(await page.getByRole('banner').evaluate((node) => node.closest('[inert]') !== null)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('banner')).toBeVisible()
})
