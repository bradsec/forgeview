import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// Opt-in large-model check. Drop a real STL at repo-root test.stl (gitignored).
const modelUrl = new URL('../test.stl', import.meta.url)
const hasModel = existsSync(modelUrl)

test.describe('Make solid on a real model', () => {
  test.skip(!hasModel, 'no test.stl fixture at repo root')
  test.slow()

  test('fills the model without leaving it empty', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Edit flow verified on desktop')
    test.setTimeout(360_000)

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

    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Make solid…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Make solid' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Interior detection detail').selectOption('96')
    await dialog.getByRole('button', { name: 'Apply' }).click()

    await expect(dialog.getByText('Solid fill complete')).toBeVisible({ timeout: 330_000 })

    const definitions = dialog.getByRole('definition')
    const labels = ['triangles', 'vertices', 'boundaryEdges', 'nonManifoldEdges', 'meshes', 'grid', 'result']
    const values: Record<string, string> = {}
    for (let i = 0; i < labels.length; i++) values[labels[i]] = ((await definitions.nth(i).textContent()) ?? '').trim()
    const triangles = values.triangles
    const [before, after] = triangles.split('→').map((n) => Number(n.replace(/[^\d]/g, '')))

    console.log('Make solid:', JSON.stringify(values))

    expect(after).toBeGreaterThan(0)
    expect(after).toBeLessThanOrEqual(before)
    // The sealed shell has no open edges: nothing reads as a hole.
    const boundaryAfter = Number(values.boundaryEdges.split('→')[1].replace(/[^\d]/g, ''))
    expect(boundaryAfter).toBe(0)
    // No error surfaced to the user.
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
})
