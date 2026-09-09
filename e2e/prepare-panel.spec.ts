import { expect, test, type Page } from '@playwright/test'

/** ASCII STL of a 20mm cube with the top (+Z) face removed: 10 triangles,
 * 4 open boundary edges, not watertight. Deterministic, no fixture file. */
function openBoxStl(): string {
  const s = 20
  const v = [
    [0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0],
    [0, 0, s], [s, 0, s], [s, s, s], [0, s, s],
  ]
  const tris = [
    [0, 1, 2], [0, 2, 3],
    [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6],
    [3, 0, 4], [3, 4, 7],
  ]
  let out = 'solid box\n'
  for (const [a, b, c] of tris) {
    out += 'facet normal 0 0 0\nouter loop\n'
    for (const i of [a, b, c]) out += `vertex ${v[i][0]} ${v[i][1]} ${v[i][2]}\n`
    out += 'endloop\nendfacet\n'
  }
  return out + 'endsolid box\n'
}

async function dropOpenBox(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate((stl) => {
    const file = new File([stl], 'box.stl', { type: 'model/stl' })
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(file)
    window.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }))
  }, openBoxStl())
  await expect(page.getByRole('banner')).toContainText('box.stl')
  await expect(page.getByRole('navigation', { name: 'Camera navigation' })).toBeVisible()
}

test.describe('Prepare panel', () => {
  test('reports a leak, fixes it with Make solid, and undoes', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Prepare flow verified on desktop')
    test.setTimeout(120_000)

    await dropOpenBox(page)

    // Desktop and mobile sidebars both mount the panel; the mobile one is
    // display:none at this width. Scope every panel locator to what is shown.
    const check = (id: string) => page.getByTestId(`check-${id}`).filter({ visible: true })

    await page.getByRole('button', { name: 'Prepare' }).click()
    const watertight = check('watertight')
    await expect(watertight).toHaveAttribute('data-state', 'fail')
    await expect(check('boundary')).toHaveAttribute('data-state', 'fail')

    // The readiness card's Fix shortcut opens the Repair modal; the seal row
    // there does what "Make solid" used to.
    await watertight.getByRole('button', { name: 'Fix' }).click()
    const dialog = page.getByRole('dialog', { name: 'Repair' })
    await expect(dialog).toBeVisible()
    const seal = dialog.getByTestId('repair-stage-seal')
    await seal.getByRole('combobox').selectOption('96')
    await seal.getByRole('button', { name: /run/i }).click()
    // No "Solid fill complete" text now: the seal row's own note is the signal.
    await expect(seal).toContainText('Watertight solid', { timeout: 90_000 })
    await expect(dialog.locator('progress')).toBeHidden()
    await dialog.getByRole('button', { name: /close/i }).click()

    await expect(check('boundary')).toHaveAttribute('data-state', 'pass')

    // Undo history now has exactly one entry for the seal.
    const history = page.getByTestId('undo-history').filter({ visible: true })
    await expect(history.getByRole('button')).toHaveText(['Make solid (seal)'])

    // Clicking the entry reverts the seal. Draining the undo stack also clears
    // the sealApplied flag, so the watertight row must read a hard 'fail'
    // again, not the informational 'warn' a lingering flag would leave.
    await history.getByRole('button', { name: /Make solid/ }).click()
    await expect(check('boundary')).toHaveAttribute('data-state', 'fail')
    await expect(watertight).toHaveAttribute('data-state', 'fail')
    await expect(page.getByTestId('undo-history').filter({ visible: true })).toHaveCount(0)
  })

  test('fills an open box with the Fill holes stage alone, then undoes it', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Prepare flow verified on desktop')
    test.setTimeout(120_000)

    await dropOpenBox(page)
    const check = (id: string) => page.getByTestId(`check-${id}`).filter({ visible: true })

    await page.getByRole('button', { name: 'Prepare' }).click()
    await expect(check('boundary')).toHaveAttribute('data-state', 'fail')

    // Fill holes stage alone seals the open box.
    await page.getByRole('button', { name: 'Repair…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Repair' })
    await expect(dialog).toBeVisible()
    await dialog.getByTestId('repair-stage-holeFill').getByRole('button', { name: /run/i }).click()
    await expect(dialog.getByTestId('repair-stage-holeFill')).toContainText(/filled/i, { timeout: 30_000 })
    await dialog.getByRole('button', { name: /close/i }).click()
    await expect(check('boundary')).toHaveAttribute('data-state', 'pass')

    // Undo from the history list re-opens the hole.
    const history = page.getByTestId('undo-history').filter({ visible: true })
    await history.getByRole('button', { name: /Fill holes/i }).click()
    await expect(check('boundary')).toHaveAttribute('data-state', 'fail')
  })

  test('fills one open loop picked in the viewport', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Viewport pick verified on desktop')
    test.setTimeout(120_000)

    await dropOpenBox(page)
    const check = (id: string) => page.getByTestId(`check-${id}`).filter({ visible: true })

    await page.getByRole('button', { name: 'Prepare' }).click()
    await expect(check('boundary')).toHaveAttribute('data-state', 'fail')

    // The fixture is loaded Z-up with no rotation, so the removed face is on
    // world +Z. The "Front" standard view puts the camera on +Z looking -Z,
    // straight into the hole, so the loop cap projects to the canvas centre.
    await page.getByRole('combobox', { name: 'Standard view' }).selectOption('front')
    await page.waitForTimeout(400) // let the camera snap animation settle

    await page.getByRole('button', { name: 'Fill a single hole' }).click()
    await expect(page.getByText(/1 open loop\b/).filter({ visible: true })).toBeVisible()

    // Click the centre of the canvas — over the open face, on the cap overlay.
    await page.locator('canvas').first().click()

    await expect(check('boundary')).toHaveAttribute('data-state', 'pass')

    const history = page.getByTestId('undo-history').filter({ visible: true })
    await expect(history.getByRole('button')).toHaveText(['Fill hole'])

    await history.getByRole('button', { name: 'Fill hole' }).click()
    await expect(check('boundary')).toHaveAttribute('data-state', 'fail')
  })

  test('Repair all seals the open box and keeps the WebGL context', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Prepare flow verified on desktop')
    test.setTimeout(180_000)

    await dropOpenBox(page)

    await page.getByRole('button', { name: 'Prepare' }).click()
    await page.getByRole('button', { name: 'Repair…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Repair' })
    await expect(dialog).toBeVisible()
    await dialog.getByTestId('repair-stage-seal').getByRole('combobox').selectOption('96')
    await dialog.getByRole('button', { name: 'Repair all' }).click()
    await expect(dialog.locator('progress')).toBeHidden({ timeout: 120_000 })
    await expect(dialog.getByTestId('repair-stage-seal')).toContainText(
      /watertight solid|0 open edges? left/i,
      { timeout: 30_000 },
    )
    await dialog.getByRole('button', { name: /close/i }).click()

    // Every readiness row that can be fixed is now satisfied.
    await expect(
      page.locator('[data-testid^="check-"][data-state="fail"]').filter({ visible: true }),
    ).toHaveCount(0)

    // The viewport's WebGL context must survive the seal's visibility pass.
    const contextLost = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')
      const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl')
      return gl ? gl.isContextLost() : true
    })
    expect(contextLost).toBe(false)
  })

  /** ASCII STL of two axis-aligned 10mm cubes, the second offset +30 on X.
   *  One solid, two disconnected shells: 24 triangles total. */
  function twoCubesStl(): string {
    const cube = (ox: number) => {
      const s = 10
      const v = [
        [ox, 0, 0], [ox + s, 0, 0], [ox + s, s, 0], [ox, s, 0],
        [ox, 0, s], [ox + s, 0, s], [ox + s, s, s], [ox, s, s],
      ]
      const tris = [
        [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
        [0, 5, 1], [0, 4, 5], [1, 6, 2], [1, 5, 6],
        [2, 7, 3], [2, 6, 7], [3, 4, 0], [3, 7, 4],
      ]
      let out = ''
      for (const [a, b, c] of tris) {
        out += 'facet normal 0 0 0\nouter loop\n'
        for (const i of [a, b, c]) out += `vertex ${v[i][0]} ${v[i][1]} ${v[i][2]}\n`
        out += 'endloop\nendfacet\n'
      }
      return out
    }
    return `solid two\n${cube(0)}${cube(30)}endsolid two\n`
  }

  async function dropStl(page: Page, stl: string, name: string): Promise<void> {
    await page.goto('/')
    await page.evaluate(({ stl, name }) => {
      const file = new File([stl], name, { type: 'model/stl' })
      const dt = new DataTransfer()
      dt.items.add(file)
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    }, { stl, name })
    await expect(page.getByRole('banner')).toContainText(name)
    await expect(page.getByRole('navigation', { name: 'Camera navigation' })).toBeVisible()
  }

  test('splits a two-body model into parts and recombines on undo', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Split flow verified on desktop')
    test.setTimeout(120_000)

    await dropStl(page, twoCubesStl(), 'two.stl')
    await page.getByRole('button', { name: 'Prepare' }).click()
    await page.getByRole('button', { name: 'Split', exact: true, expanded: false }).filter({ visible: true }).click()

    // exact: after the split the undo-history entry is also named "Split by shell".
    const splitBtn = page.getByRole('button', { name: 'Split by shell', exact: true }).filter({ visible: true })
    await expect(splitBtn).toBeEnabled()
    await splitBtn.click()

    const parts = page.getByTestId('split-parts').filter({ visible: true })
    await expect(parts.getByRole('listitem')).toHaveCount(2)
    await expect(parts).toContainText('tris')
    await expect(splitBtn).toBeDisabled()

    // hide part 2
    const p2 = parts.getByRole('checkbox').nth(1)
    await p2.uncheck()
    await expect(p2).not.toBeChecked()

    // undo the split from the history list -> back to one model, list gone
    const history = page.getByTestId('undo-history').filter({ visible: true })
    await history.getByRole('button', { name: /split by shell/i }).click()
    await expect(page.getByTestId('split-parts').filter({ visible: true })).toHaveCount(0)
    await expect(splitBtn).toBeEnabled()
  })
})
