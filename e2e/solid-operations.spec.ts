import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { BoxGeometry, Mesh } from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'

const csp = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')).app.security.csp as string
const boxStl = new STLExporter().parse(new Mesh(new BoxGeometry(20, 20, 20))) as string

async function productionPolicy(page: Page) {
  await page.route('**/*', async route => {
    if (!route.request().isNavigationRequest()) return route.continue()
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } })
  })
  await page.addInitScript(() => {
    const violations: string[] = []
    Object.defineProperty(window, '__cspViolations', { value: violations })
    document.addEventListener('securitypolicyviolation', event => violations.push(`${event.violatedDirective}: ${event.blockedURI}`))
  })
}
async function drop(page: Page, content: string, name: string) {
  await page.goto('/')
  await page.evaluate(({ content, name }) => {
    const bytes = Uint8Array.from(atob(content), c => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], name))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, { content, name })
  await expect(page.getByRole('banner')).toContainText(name)
  await expect(page.getByRole('navigation', { name: 'Camera navigation' })).toBeVisible()
}
async function prepare(page: Page) {
  await page.getByRole('button', { name: 'Prepare', exact: true }).filter({ visible: true }).click()
  await page.getByRole('button', { name: 'Solid operations', exact: true, expanded: false }).filter({ visible: true }).click()
}
async function assertPolicy(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations)).toEqual([])
}

function texturedGlb() {
  const geometry = new BoxGeometry(20, 20, 20).toNonIndexed()
  const chunks: Buffer[] = []
  const views: { buffer: number; byteOffset: number; byteLength: number }[] = []
  let length = 0
  for (const name of ['position', 'normal', 'uv']) {
    const attribute = geometry.getAttribute(name)
    const chunk = Buffer.from(attribute.array.buffer)
    views.push({ buffer: 0, byteOffset: length, byteLength: chunk.length })
    chunks.push(chunk)
    length += chunk.length
  }
  const png = readFileSync(new URL('../public/favicon-16x16.png', import.meta.url))
  views.push({ buffer: 0, byteOffset: length, byteLength: png.length })
  chunks.push(png)
  length += png.length
  chunks.push(Buffer.alloc((4 - length % 4) % 4))
  const binary = Buffer.concat(chunks)
  const document = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 } }],
    textures: [{ source: 0 }], images: [{ bufferView: 3, mimeType: 'image/png' }],
    buffers: [{ byteLength: binary.length }], bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: 36, type: 'VEC3', min: [-10, -10, -10], max: [10, 10, 10] },
      { bufferView: 1, componentType: 5126, count: 36, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 36, type: 'VEC2' },
    ],
  }
  const json = Buffer.from(JSON.stringify(document))
  const paddedJson = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)])
  const header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(28 + paddedJson.length + binary.length, 8)
  header.writeUInt32LE(paddedJson.length, 12)
  header.writeUInt32LE(0x4e4f534a, 16)
  const binaryHeader = Buffer.alloc(8)
  binaryHeader.writeUInt32LE(binary.length, 0)
  binaryHeader.writeUInt32LE(0x004e4942, 4)
  geometry.dispose()
  return Buffer.concat([header, paddedJson, binaryHeader, binary]).toString('base64')
}

test.describe('Solid operations with packaged CSP', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'Solid operations verified on desktop')
    test.setTimeout(120_000)
    await productionPolicy(page)
  })
  test('cuts a closed box, deletes one part, and undoes both edits', async ({ page }) => {
    await drop(page, Buffer.from(boxStl).toString('base64'), 'closed-box.stl')
    await prepare(page)
    await page.getByRole('button', { name: 'Analysis', exact: true, expanded: false }).filter({ visible: true }).click()
    await page.getByRole('button', { name: 'Show clip plane', exact: true }).filter({ visible: true }).click()
    await page.getByLabel('Clip position').filter({ visible: true }).fill('0.5')
    await page.getByRole('button', { name: 'Cut at plane', exact: true }).filter({ visible: true }).click()
    await page.getByRole('button', { name: 'Split', exact: true, expanded: false }).filter({ visible: true }).click()
    const parts = page.getByTestId('split-parts').filter({ visible: true })
    await expect(parts.getByRole('listitem')).toHaveCount(2)
    await parts.getByRole('button', { name: /^Delete / }).first().click()
    await expect(parts.getByRole('listitem')).toHaveCount(1)
    const undo = page.getByRole('button', { name: 'Undo last model edit', exact: true }).filter({ visible: true })
    await undo.click()
    await expect(parts.getByRole('listitem')).toHaveCount(2)
    await undo.click()
    await expect(parts).toHaveCount(0)
    await expect(undo).toBeDisabled()
    await assertPolicy(page)
  })
  test('hollows and drains a box, then restores its original geometry', async ({ page }) => {
    await drop(page, Buffer.from(boxStl).toString('base64'), 'hollow-box.stl')
    await page.getByTestId('unit-prompt').filter({ visible: true }).getByRole('button', { name: 'Apply', exact: true }).click()
    await prepare(page)
    await page.getByLabel('Drain radius (mm)', { exact: true }).filter({ visible: true }).fill('1')
    await page.getByRole('button', { name: 'Hollow model', exact: true }).filter({ visible: true }).click()
    await expect(page.getByText('Hollow complete. Undo restores the original.', { exact: true }).filter({ visible: true })).toBeVisible()
    const history = page.getByTestId('undo-history').filter({ visible: true })
    await expect(history.getByRole('button', { name: /Hollow/ })).toBeVisible()
    await page.getByRole('button', { name: 'Undo last model edit', exact: true }).filter({ visible: true }).click()
    await expect(history).toHaveCount(0)
    await assertPolicy(page)
  })
  test('unions two folder models and restores both operands with undo', async ({ page }) => {
    await page.addInitScript(stl => {
      const files = ['a.stl', 'b.stl'].map(name => new File([stl], name))
      Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => ({
        name: 'solids', kind: 'directory', async *values() {
          for (const file of files) yield { name: file.name, kind: 'file', getFile: async () => file }
        },
      }) })
    }, boxStl)
    await page.goto('/')
    await page.getByRole('button', { name: 'File', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Open folder', exact: true }).click()
    await page.getByRole('main').getByRole('button', { name: 'Add a.stl to scene' }).click()
    await page.getByRole('main').getByRole('button', { name: 'Add b.stl to scene' }).click()
    await page.getByRole('button', { name: '3D', exact: true }).click()
    await page.getByTestId('unit-prompt').filter({ visible: true }).getByRole('button', { name: 'Apply', exact: true }).click()
    await prepare(page)
    const section = page.getByRole('region', { name: 'Solid operations' }).filter({ visible: true })
    await section.getByLabel('Model A').selectOption({ label: 'a.stl' })
    await section.getByLabel('Model B').selectOption({ label: 'b.stl' })
    await section.getByRole('button', { name: 'Apply boolean' }).click()
    await expect(section).toContainText('Boolean complete. Undo restores the original.')
    const history = page.getByTestId('undo-history').filter({ visible: true })
    await expect(history).toContainText('Boolean union')
    await page.getByRole('button', { name: 'Undo last model edit', exact: true }).filter({ visible: true }).click()
    await expect(history).toHaveCount(0)
    await section.getByRole('button', { name: 'Apply boolean' }).click()
    await expect(history).toContainText('Boolean union')
    await assertPolicy(page)
  })
  test('loads an embedded GLB texture without CSP violations', async ({ page }) => {
    const errors: string[] = []
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await drop(page, texturedGlb(), 'embedded-texture.glb')
    await prepare(page)
    await page.getByRole('button', { name: 'Hollow model', exact: true }).filter({ visible: true }).click()
    await expect(page.getByRole('region', { name: 'Solid operations' }).filter({ visible: true })).toContainText(/untextured|texture/)
    await expect(page.getByTestId('undo-history').filter({ visible: true })).toHaveCount(0)
    expect(errors.filter(message => /texture|image|security|content security/i.test(message))).toEqual([])
    await assertPolicy(page)
  })
})
