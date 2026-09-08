import { existsSync, readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// Opt-in large-model check. Drop a real STL at repo-root test.stl (gitignored).
const modelUrl = new URL('../test.stl', import.meta.url)
const hasModel = existsSync(modelUrl)

async function dropModel(page: Page): Promise<void> {
  const base64 = readFileSync(modelUrl).toString('base64')
  await page.goto('/')
  await page.evaluate((b64) => {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const file = new File([bytes], 'test.stl', { type: 'model/stl' })
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(file)
    window.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }))
  }, base64)
  await expect(page.getByRole('banner')).toContainText('test.stl')
  await expect(page.getByRole('navigation', { name: 'Camera navigation' })).toBeVisible()
}

const visibleCheck = (page: Page, id: string) =>
  page.getByTestId(`check-${id}`).filter({ visible: true })

/** Read a numeric value from the Details tab's File Info / Geometry lists.
 * The Repair modal no longer renders a stats table, so the panel is the only
 * place these counts are shown. */
async function detailValue(page: Page, term: string): Promise<number> {
  await page.getByRole('tab', { name: 'Details' }).click()
  const dd = page.getByRole('tabpanel', { name: 'Details' })
    .getByRole('term').filter({ hasText: term }).locator('xpath=following-sibling::dd[1]')
  const text = ((await dd.textContent()) ?? '').trim()
  return Number(text.replace(/[^\d]/g, ''))
}

async function runSeal(page: Page) {
  await page.getByRole('button', { name: 'Prepare' }).click()
  await page.getByRole('button', { name: 'Repair…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Repair' })
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('Make solid on a real model', () => {
  test.skip(!hasModel, 'no test.stl fixture at repo root')
  test.slow()

  test('fills the model without leaving it empty', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Prepare flow verified on desktop')
    test.setTimeout(360_000)

    await dropModel(page)
    const trisBefore = await detailValue(page, 'Triangles')

    const dialog = await runSeal(page)
    const seal = dialog.getByTestId('repair-stage-seal')
    await seal.getByRole('combobox').selectOption('96')
    await seal.getByRole('button', { name: /run/i }).click()
    await expect(dialog.locator('progress')).toBeHidden({ timeout: 330_000 })
    // The seal row's note replaces the old "Solid fill complete" text.
    await expect(seal).toContainText(/watertight solid|0 open edges? left/i)
    await dialog.getByRole('button', { name: /close/i }).click()

    // The sealed shell has no open edges: nothing reads as a hole.
    await expect(visibleCheck(page, 'boundary')).toHaveAttribute('data-state', 'pass')
    await expect(page.getByRole('alert')).toHaveCount(0)

    const trisAfter = await detailValue(page, 'Triangles')
    console.log('Make solid triangles:', trisBefore, '->', trisAfter)
    // Not left empty; kept exterior only, so the count never grows.
    expect(trisAfter).toBeGreaterThan(0)
    expect(trisAfter).toBeLessThanOrEqual(trisBefore)
    // Skin protection: a shell with no enclosed cavities loses almost nothing;
    // over-dropping here is what punched the flat-bottomed gashes.
    expect(trisBefore - trisAfter).toBeLessThan(trisBefore * 0.02)

    // The viewport's WebGL context must survive the visibility pass (a second
    // context here used to evict it and blank the view).
    const contextLost = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')
      const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl')
      return gl ? gl.isContextLost() : true
    })
    expect(contextLost).toBe(false)
  })

  test('remove internal walls drops the non-manifold count', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Prepare flow verified on desktop')
    test.setTimeout(360_000)

    await dropModel(page)
    const nmBefore = await detailValue(page, 'Non-manifold')
    const trisBefore = await detailValue(page, 'Triangles')

    const dialog = await runSeal(page)
    const seal = dialog.getByTestId('repair-stage-seal')

    const strip = seal.getByRole('checkbox', { name: /Remove internal walls/ })
    if (!(await strip.isEnabled())) {
      test.skip(true, 'headless GL has no WebGL2, strip mode unavailable')
    }
    await strip.check()
    await seal.getByRole('combobox').selectOption('96')
    await seal.getByRole('button', { name: /run/i }).click()
    await expect(dialog.locator('progress')).toBeHidden({ timeout: 330_000 })
    await expect(seal).toContainText(/watertight solid|0 open edges? left/i)
    await dialog.getByRole('button', { name: /close/i }).click()

    // Skin still sealed with no open edges.
    await expect(visibleCheck(page, 'boundary')).toHaveAttribute('data-state', 'pass')
    await expect(page.getByRole('alert')).toHaveCount(0)

    const nmAfter = await detailValue(page, 'Non-manifold')
    const trisAfter = await detailValue(page, 'Triangles')
    console.log('Make solid (strip walls) non-manifold:', nmBefore, '->', nmAfter, 'tris:', trisBefore, '->', trisAfter)

    // Internal partitions removed: fewer non-manifold edges than the source,
    // some triangles gone.
    expect(nmAfter).toBeLessThan(nmBefore)
    expect(trisAfter).toBeLessThan(trisBefore)
  })
})
