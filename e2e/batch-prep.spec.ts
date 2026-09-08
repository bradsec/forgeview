import { expect, test } from '@playwright/test'
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js'

function boxStl(width: number, height: number, depth: number): string {
  const vertices = [
    [0, 0, 0], [width, 0, 0], [width, height, 0], [0, height, 0],
    [0, 0, depth], [width, 0, depth], [width, height, depth], [0, height, depth],
  ]
  const faces = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ]
  return `solid box\n${faces.map((face) =>
    `facet normal 0 0 0\nouter loop\n${face.map((vertex) => `vertex ${vertices[vertex].join(' ')}`).join('\n')}\nendloop\nendfacet`
  ).join('\n')}\nendsolid box\n`
}

test('prepares two folder models in a worker and downloads STLs with a manifest', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Batch folder workflow verified on desktop')
  await page.addInitScript(({ first, second }) => {
    const files = [new File([first], 'first.stl'), new File([second], 'second.stl')]
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => ({
        name: 'batch-models',
        kind: 'directory',
        async *values() {
          for (const file of files) yield { name: file.name, kind: 'file', getFile: async () => file }
        },
      }),
    })
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined })
  }, { first: boxStl(10, 20, 30), second: boxStl(12, 8, 16) })
  await page.goto('/')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Open folder', exact: true }).click()
  await page.getByRole('button', { name: 'Batch prepare (2)' }).click()
  await page.getByLabel('Unitless input units').selectOption('mm')
  await page.getByRole('button', { name: 'Prepare files', exact: true }).click()
  await expect(page.getByText('2 prepared, 0 failed, 0 skipped.', { exact: true })).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export ZIP', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('forgeview-prepared.zip')
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const archive = unzipSync(new Uint8Array(Buffer.concat(chunks)))
  expect(Object.keys(archive).sort()).toEqual(['001-first.stl', '002-second.stl', 'manifest.json'])
  const manifest = JSON.parse(strFromU8(archive['manifest.json']))
  expect(manifest.outputUnit).toBe('mm')
  expect(manifest.upAxis).toBe('Z')
  expect(manifest.entries).toEqual([
    expect.objectContaining({ status: 'success', output: '001-first.stl' }),
    expect.objectContaining({ status: 'success', output: '002-second.stl' }),
  ])
  for (const name of ['001-first.stl', '002-second.stl']) {
    const bytes = archive[name]
    const triangles = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true)
    expect(triangles).toBe(12)
    expect(bytes.byteLength).toBe(84 + triangles * 50)
  }
})
