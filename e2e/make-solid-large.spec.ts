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

const LABELS = ['triangles', 'vertices', 'boundaryEdges', 'nonManifoldEdges', 'meshes', 'grid', 'result']
const pairAfter = (text: string) => Number(text.split('→')[1].replace(/[^\d]/g, ''))
const pairBefore = (text: string) => Number(text.split('→')[0].replace(/[^\d]/g, ''))

test.describe('Make solid on a real model', () => {
  test.skip(!hasModel, 'no test.stl fixture at repo root')
  test.slow()

  test('fills the model without leaving it empty', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Edit flow verified on desktop')
    test.setTimeout(360_000)

    await dropModel(page)
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Make solid…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Make solid' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Interior detection detail').selectOption('96')
    await dialog.getByRole('button', { name: 'Apply' }).click()
    await expect(dialog.getByText('Solid fill complete')).toBeVisible({ timeout: 330_000 })

    const definitions = dialog.getByRole('definition')
    const values: Record<string, string> = {}
    for (let i = 0; i < LABELS.length; i++) values[LABELS[i]] = ((await definitions.nth(i).textContent()) ?? '').trim()
    console.log('Make solid:', JSON.stringify(values))

    expect(pairAfter(values.triangles)).toBeGreaterThan(0)
    expect(pairAfter(values.triangles)).toBeLessThanOrEqual(pairBefore(values.triangles))
    // Skin protection: a shell with no enclosed cavities loses almost nothing;
    // over-dropping here is what punched the flat-bottomed gashes.
    expect(pairBefore(values.triangles) - pairAfter(values.triangles)).toBeLessThan(pairBefore(values.triangles) * 0.02)
    // The sealed shell has no open edges: nothing reads as a hole.
    expect(pairAfter(values.boundaryEdges)).toBe(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('remove internal walls drops the non-manifold count', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Edit flow verified on desktop')
    test.setTimeout(360_000)

    await dropModel(page)
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Make solid…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Make solid' })
    await expect(dialog).toBeVisible()

    const strip = dialog.getByRole('checkbox', { name: /Remove internal walls/ })
    if (!(await strip.isEnabled())) {
      test.skip(true, 'headless GL has no WebGL2, strip mode unavailable')
    }
    await strip.check()
    await dialog.getByLabel('Interior detection detail').selectOption('96')
    await dialog.getByRole('button', { name: 'Apply' }).click()
    await expect(dialog.getByText('Solid fill complete')).toBeVisible({ timeout: 330_000 })

    const definitions = dialog.getByRole('definition')
    const values: Record<string, string> = {}
    for (let i = 0; i < LABELS.length; i++) values[LABELS[i]] = ((await definitions.nth(i).textContent()) ?? '').trim()
    console.log('Make solid (strip walls):', JSON.stringify(values))

    // Internal partitions removed: fewer non-manifold edges than the source,
    // some triangles gone, skin still sealed with no open edges.
    expect(pairAfter(values.nonManifoldEdges)).toBeLessThan(pairBefore(values.nonManifoldEdges))
    expect(pairAfter(values.triangles)).toBeLessThan(pairBefore(values.triangles))
    expect(pairAfter(values.boundaryEdges)).toBe(0)
    await expect(dialog.getByText(/removal was skipped/)).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
})
