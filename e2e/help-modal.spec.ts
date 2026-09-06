import { expect, test } from '@playwright/test'

test.describe('Feature guide', () => {
  test('opens from the Help menu and closes on Escape', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Help menu verified on desktop')
    await page.goto('/')

    await page.getByRole('button', { name: 'Help' }).click()
    await page.getByRole('menuitem', { name: 'Feature guide' }).click()

    const dialog = page.getByRole('dialog', { name: 'Feature guide' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Repair' })).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Overhang heatmap' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
})
