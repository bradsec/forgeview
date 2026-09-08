import { expect, test, type Page } from '@playwright/test'
import { BoxGeometry, Mesh, SphereGeometry } from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'

async function dropStl(page: Page, stl: string, name: string) {
  await page.goto('/')
  await page.evaluate(({ stl, name }) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([stl], name, { type: 'model/stl' }))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  }, { stl, name })
  await expect(page.getByRole('banner')).toContainText(name)
  await expect(page.getByRole('navigation', { name: 'Camera navigation' })).toBeVisible()
  await page.getByRole('button', { name: 'Prepare', exact: true }).filter({ visible: true }).click()
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
