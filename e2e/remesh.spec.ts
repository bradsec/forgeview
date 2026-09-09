import { expect, test, type Page } from '@playwright/test'
import { BoxGeometry, Mesh, SphereGeometry } from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'

async function dropStl(page: Page, stl: string | DataView, name: string) {
  await page.goto('/')
  const binary = typeof stl !== 'string'
  const data = binary ? Buffer.from(stl.buffer, stl.byteOffset, stl.byteLength).toString('base64') : stl
  await page.evaluate(({ data, binary, name }) => {
    const transfer = new DataTransfer()
    const contents = binary ? Uint8Array.from(atob(data), character => character.charCodeAt(0)) : data
    transfer.items.add(new File([contents], name, { type: 'model/stl' }))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  }, { data, binary, name })
  await expect(page.getByRole('banner')).toContainText(name)
  await expect(page.getByRole('navigation', { name: 'Camera navigation' })).toBeVisible()
  await page.getByRole('button', { name: 'Prepare', exact: true }).filter({ visible: true }).click()
  await page.getByRole('button', { name: 'Decimate / remesh', exact: true, expanded: false }).filter({ visible: true }).click()
}

for (const operation of ['decimate', 'remesh'] as const) {
  test(`${operation} accepts a model above 100,000 triangles and restores it with undo`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'Large-model worker flow verified on desktop')
    test.setTimeout(120_000)
    const geometry = new BoxGeometry(8, 8, 8, 100, 100, 100)
    const before = geometry.index!.count / 3
    expect(before).toBeGreaterThan(100_000)
    const stl = new STLExporter().parse(new Mesh(geometry), { binary: true })
    geometry.dispose()
    await dropStl(page, stl, 'large-box.stl')
    const section = page.getByRole('heading', { name: 'Decimate / remesh', exact: true }).filter({ visible: true }).locator('..')
    await section.getByRole('combobox').selectOption(operation)
    if (operation === 'decimate') await section.getByLabel('Target triangles').fill('6000')
    else await section.getByLabel('Grid resolution').fill('8')
    const apply = section.getByRole('button', { name: 'Apply remesh' })
    await expect(apply).toBeEnabled()
    await apply.click()
    await expect(section.getByRole('status')).toHaveText(/^120,000 → [\d,]+ triangles$/, { timeout: 60_000 })
    const result = (await section.getByRole('status').textContent())!
    const after = Number(result.split(' → ')[1].replace(/[^\d]/g, ''))
    expect(after).toBeGreaterThan(0)
    if (operation === 'decimate') expect(after).toBeLessThanOrEqual(6000)
    else expect(after).toBe(768)
    const undo = page.getByRole('button', { name: 'Undo last model edit', exact: true }).filter({ visible: true })
    await undo.click()
    await expect(undo).toBeDisabled()
    // The restored input must still be accepted and produce the same reduction.
    await apply.click()
    await expect(section.getByRole('status')).toHaveText(result, { timeout: 60_000 })
  })
}

for (const operation of ['decimate', 'remesh'] as const) {
  test(`${operation} runs in a real worker and undo restores its input`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'Remeshing flow verified on desktop')
    test.setTimeout(120_000)
    const geometry = operation === 'decimate' ? new SphereGeometry(10, 16, 12) : new BoxGeometry(8, 8, 8)
    const before = geometry.index!.count / 3
    const stl = new STLExporter().parse(new Mesh(geometry)) as string
    geometry.dispose()
    await dropStl(page, stl, `${operation}.stl`)
    const section = page.getByRole('heading', { name: 'Decimate / remesh', exact: true }).filter({ visible: true }).locator('..')
    await section.getByRole('combobox').selectOption(operation)
    if (operation === 'decimate') await section.getByLabel('Target triangles').fill('100')
    else await section.getByLabel('Grid resolution').fill('8')
    const apply = section.getByRole('button', { name: 'Apply remesh' })
    await apply.click()
    await expect(section.getByRole('status')).toHaveText(new RegExp(`^${before.toLocaleString()} → [\\d,]+ triangles$`))
    const result = (await section.getByRole('status').textContent())!
    const after = Number(result.split(' → ')[1].replace(/[^\d]/g, ''))
    if (operation === 'decimate') expect(after).toBeLessThan(before)
    else expect(after).toBe(768)
    const history = page.getByTestId('undo-history').filter({ visible: true })
    await expect(history).toContainText(operation === 'decimate' ? 'Decimate' : 'Uniform remesh')
    const undo = page.getByRole('button', { name: 'Undo last model edit', exact: true }).filter({ visible: true })
    await undo.click()
    await expect(history).toHaveCount(0)
    await expect(undo).toBeDisabled()
    // Processing again must receive the original geometry, not the previous output.
    await apply.click()
    await expect(section.getByRole('status')).toHaveText(result)
    await expect(undo).toBeEnabled()
    await undo.click()
    await expect(history).toHaveCount(0)
  })
}
