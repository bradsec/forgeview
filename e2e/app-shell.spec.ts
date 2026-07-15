import { expect, test, type Page } from '@playwright/test'

const browserErrors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  browserErrors.set(page, errors)
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`))
  await page.goto('/')
})

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([])
})

test('renders the redesigned application shell within the viewport', async ({ page, isMobile }) => {
  await expect(page.getByRole('banner')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Open a model to start' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open file' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'View' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Help' })).toBeVisible()

  const viewport = page.viewportSize()
  const bodyBounds = await page.locator('body').boundingBox()
  expect(bodyBounds?.width).toBeLessThanOrEqual(viewport?.width ?? Infinity)
  expect(bodyBounds?.height).toBeLessThanOrEqual(viewport?.height ?? Infinity)

  const footer = page.getByRole('contentinfo')
  if (isMobile) await expect(footer).toBeHidden()
  else {
    await expect(footer).toBeVisible()
    await expect(footer.getByRole('link', { name: 'github.com/bradsec/forgeview' })).toHaveAttribute('href', 'https://github.com/bradsec/forgeview')
    await expect(footer).toContainText('v1.4.0')
  }
})

test('supports keyboard menu navigation and Escape focus restoration', async ({ page }) => {
  const fileTrigger = page.getByRole('button', { name: 'File', exact: true })
  await fileTrigger.click()
  const menu = page.getByTestId('toolbar-file-menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Open file' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Open folder' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(fileTrigger).toBeFocused()
})

test('opens Help and displays complete About information', async ({ page }) => {
  await page.getByRole('button', { name: 'Help' }).click()
  await expect(page.getByText('STL, 3MF, OBJ, GLTF, GLB, PLY and DAE')).toBeVisible()
  await page.getByRole('menuitem', { name: 'About Forgeview' }).click()

  const dialog = page.getByRole('dialog', { name: 'Forgeview' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Version')
  await expect(dialog).toContainText('1.4.0')
  await expect(dialog.getByRole('link', { name: 'github.com/bradsec/forgeview' })).toHaveAttribute('href', 'https://github.com/bradsec/forgeview')
  await expect(dialog).toContainText('Found Forgeview useful? Support the creator.')
  await expect(dialog.getByRole('link', { name: 'Buy me a coffee' })).toHaveAttribute('href', 'https://buymeacoffee.com/markbradley')
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toBeHidden()
})

test('publishes the branded favicon, manifest and social preview metadata', async ({ page }) => {
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', /icon\.svg$/)
  await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute('content', /Forgeview/)
  await expect(page.locator('meta[name="twitter:image:alt"]')).toHaveAttribute('content', /Forgeview/)
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#1b2027')

  for (const asset of ['icon.svg', 'favicon.ico', 'favicon-32x32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'og-image.png']) {
    const response = await page.request.get(asset)
    expect(response.ok(), asset).toBe(true)
  }

  const manifestResponse = await page.request.get('site.webmanifest')
  expect(manifestResponse.ok()).toBe(true)
  const manifest = await manifestResponse.json()
  expect(manifest.theme_color).toBe('#1b2027')
  expect(manifest.icons).toHaveLength(2)
})

test('uses the Forgeview ember palette in both themes', async ({ page }) => {
  const root = page.locator('html')
  await expect(root).toHaveCSS('--accent', '#E68A4E')
  const repositoryLink = page.locator('.status-bar a')
  await expect(repositoryLink).toHaveCSS('color', 'rgb(230, 138, 78)')

  await page.getByRole('button', { name: 'View' }).click()
  await page.getByRole('menuitem', { name: 'Light theme' }).click()
  await expect(root).toHaveCSS('--accent', '#A94720')
  await expect(repositoryLink).toHaveCSS('color', 'rgb(169, 71, 32)')
})

test('keeps all mobile menu controls reachable', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile-only responsive check')
  await page.getByRole('button', { name: 'View' }).click()
  const menu = page.getByTestId('toolbar-view-menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Details' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Settings' })).toBeVisible()

  const box = await menu.boundingBox()
  const viewport = page.viewportSize()
  expect(box?.x).toBeGreaterThanOrEqual(0)
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? Infinity)
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport?.height ?? Infinity)
})
