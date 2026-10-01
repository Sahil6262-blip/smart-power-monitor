import { expect, test } from '@playwright/test'
import { workspace } from './helpers/cloud'

const pages = [
  ['/', 'Energy overview'],
  ['/live', 'Live monitoring'],
  ['/consumption', 'Consumption'],
  ['/insights', 'AI insights'],
  ['/alerts', 'Alerts & events'],
  ['/history', 'Historical data'],
  ['/reports', 'Energy reports'],
  ['/device', 'Device status'],
  ['/settings', 'Settings'],
]

test('white workspace remains usable across every page and viewport', async ({ page }) => {
  test.setTimeout(120000)
  await workspace(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const [path, title] of pages) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible()
      await expect(page.locator('.loading')).toHaveCount(0)
      await page.evaluate(() => document.fonts.ready)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        path + ' at ' + width,
      ).toBeLessThanOrEqual(width)
      if (width > 600) {
        const main = await page.locator('main').boundingBox()
        const sidebar = await page.locator('.sidebar').boundingBox()
        expect(main!.x, path + ' clears sidebar').toBeGreaterThanOrEqual(
          sidebar!.x + sidebar!.width,
        )
      }
      if (
        (path === '/' && width !== 320) ||
        (['/consumption', '/settings', '/history', '/insights'].includes(path) && width === 1440)
      ) {
        await page.screenshot({
          path: 'test-results/white-' + (path.slice(1) || 'dashboard') + '-' + width + '.png',
          fullPage: true,
          animations: 'disabled',
        })
      }
    }
  }
  expect(errors).toEqual([])
})

test('navigation supports search, keyboard, collapse, and mobile focus', async ({ page }) => {
  await workspace(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByLabel('Find a page')).toBeFocused()
  await page.getByLabel('Find a page').fill('history')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/history$/)
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('button', { name: 'Search pages' }).click()
  await page.getByLabel('Find a page').fill('no-such-page')
  await expect(page.getByText(/No pages match/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Search pages' })).toBeFocused()
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect(page.locator('.app-shell')).toHaveClass(/collapsed/)
  await page.reload()
  await expect(page.locator('.app-shell')).toHaveClass(/collapsed/)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.locator('.sidebar')).toHaveClass(/mobile-open/)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Settings' })
    .click()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.locator('.sidebar')).not.toHaveClass(/mobile-open/)
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
})

test('charts, history, exports, alerts and settings retain their API behavior', async ({
  page,
}) => {
  const requests = await workspace(page)
  await page.goto('/')
  await expect(page.getByTestId('metric-power')).toContainText('393.8')
  await page.getByRole('button', { name: '10 min', exact: true }).click()
  await expect
    .poll(() => requests.some((r) => r.path === '/history/trend?range=10m&points=240'))
    .toBeTruthy()
  await page.goto('/live')
  await page.getByRole('button', { name: 'Voltage', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Voltage over time' })).toBeVisible()
  await page.goto('/history')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByText('Page 2 of 3')).toBeVisible()
  await page.getByLabel('Date range').selectOption('week')
  await expect(page.getByText('Page 1 of 3')).toBeVisible()
  await expect
    .poll(() => requests.some((r) => r.path.includes('/history?range=week&page=1')))
    .toBeTruthy()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
  expect((await downloaded).suggestedFilename()).toBe('power-readings.csv')
  await page.goto('/alerts')
  await page.getByRole('button', { name: 'Acknowledge', exact: true }).click()
  await expect(page.getByText('Acknowledged', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Resolve', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'All clear. You’re in good shape.' }),
  ).toBeVisible()
  await page.goto('/settings')
  await page.getByLabel('Minimum voltage', { exact: true }).fill('260')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('alert')).toContainText('Minimum voltage must be less')
  expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(0)
  await page.getByLabel('Minimum voltage', { exact: true }).fill('215')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText(/Settings saved/)).toBeVisible()
  expect(requests.find((r) => r.method === 'PUT')?.body).toMatchObject({ min_voltage: 215 })
})

test('hardware without readings shows honest empty states in the light theme', async ({ page }) => {
  await workspace(page, true)
  await page.goto('/')
  await expect(page.getByTestId('metric-power')).toContainText('—')
  await expect(page.getByRole('heading', { name: 'Waiting for readings' })).toBeVisible()
  await expect(page.locator('.flow-state')).toHaveText('Awaiting signal')
  await expect(page.locator('.source-card strong')).toHaveText('Hardware source')
  expect(
    await page
      .locator('.panel')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe('rgb(255, 255, 255)')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(
    await page.locator('.page-enter').evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none')
})
