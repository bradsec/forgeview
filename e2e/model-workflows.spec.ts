import { expect, test } from '@playwright/test'

// Minimal ASCII STL: two facets forming a unit square
const CUBE_STL = `solid cube
facet normal 0 0 1
outer loop
vertex 0 0 1
vertex 1 0 1
vertex 1 1 1
endloop
endfacet
facet normal 0 0 1
outer loop
vertex 0 0 1
vertex 1 1 1
vertex 0 1 1
endloop
endfacet
endsolid cube
`

const OPEN_BOX_STL = `solid openbox
facet normal 0 0 -1
outer loop
vertex 0 0 0
vertex 1 1 0
vertex 1 0 0
endloop
endfacet
facet normal 0 0 -1
outer loop
vertex 0 0 0
vertex 0 1 0
vertex 1 1 0
endloop
endfacet
facet normal 0 -1 0
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 1 0 1
endloop
endfacet
facet normal 0 -1 0
outer loop
vertex 0 0 0
vertex 1 0 1
vertex 0 0 1
endloop
endfacet
facet normal 0 1 0
outer loop
vertex 0 1 0
vertex 0 1 1
vertex 1 1 1
endloop
endfacet
facet normal 0 1 0
outer loop
vertex 0 1 0
vertex 1 1 1
vertex 1 1 0
endloop
endfacet
facet normal -1 0 0
outer loop
vertex 0 0 0
vertex 0 0 1
vertex 0 1 1
endloop
endfacet
facet normal -1 0 0
outer loop
vertex 0 0 0
vertex 0 1 1
vertex 0 1 0
endloop
endfacet
facet normal 1 0 0
outer loop
vertex 1 0 0
vertex 1 1 0
vertex 1 1 1
endloop
endfacet
facet normal 1 0 0
outer loop
vertex 1 0 0
vertex 1 1 1
vertex 1 0 1
endloop
endfacet
endsolid openbox
`

/** Drop an in-memory STL file onto the window (browser drag-and-drop path). */
async function dropStl(page: import('@playwright/test').Page, name: string, content = CUBE_STL): Promise<void> {
  await page.evaluate(
    ({ content, fileName }) => {
      const file = new File([content], fileName, { type: 'model/stl' })
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      window.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }))
    },
    { content, fileName: name }
  )
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('loads a dropped model into the 3D view with file info', async ({ page }) => {
  await dropStl(page, 'dropped.stl')
  await expect(page.getByRole('navigation', { name: 'Camera navigation' })).toBeVisible()
  const banner = page.getByRole('banner')
  await expect(banner).toContainText('dropped.stl')
})

test('drop works again while a model is already open', async ({ page }) => {
  await dropStl(page, 'first.stl')
  await expect(page.getByRole('banner')).toContainText('first.stl')
  await dropStl(page, 'second.stl')
  await expect(page.getByRole('banner')).toContainText('second.stl')
})

test('exports the open model as binary STL via download', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Export flow verified on desktop')
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
  await page.reload()
  await dropStl(page, 'exportme.stl')
  await expect(page.getByRole('navigation', { name: 'Camera navigation' })).toBeVisible()

  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Export model as…' }).click()

  const dialog = page.getByRole('dialog', { name: 'Export model' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('radio', { name: 'STL (binary)' })).toBeChecked()

  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('exportme.stl')

  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const bytes = Buffer.concat(chunks)
  // Binary STL: 80-byte header + count + 2 triangles * 50 bytes
  expect(bytes.byteLength).toBe(84 + 2 * 50)
  expect(bytes.readUInt32LE(80)).toBe(2)
})

test('makes the open model solid from the Edit menu with visible progress', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Edit flow verified on desktop')
  await dropStl(page, 'repairme.stl', OPEN_BOX_STL)
  await expect(page.getByRole('navigation', { name: 'Camera navigation' })).toBeVisible()

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Make solid…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Make solid' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expect(dialog.getByText('Solid fill complete')).toBeVisible()
  await expect(dialog.getByText('Watertight solid')).toBeVisible()
})

test('export menu item is disabled with no model open', async ({ page }) => {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Export model as…' })).toBeDisabled()
})

test('shows the in-app notice before the folder-picker fallback', async ({ page }) => {
  // Force the webkitdirectory fallback (Firefox/Safari behavior)
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true })
  })
  await page.reload()

  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Open folder' }).click()

  const dialog = page.getByRole('dialog', { name: 'Open a local folder' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('nothing leaves your device')

  // Cancel closes without opening any picker
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
})
