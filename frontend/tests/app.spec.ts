import { expect, test } from '@playwright/test'

test.beforeEach(async ({ request }) => {
  const health = await (await request.get('/api/health')).json()
  test.skip(health.source !== 'demo', 'Demo interaction tests require an explicit demo server.')
})

test('live data, routes, exports, and responsive navigation', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Energy overview' })).toBeVisible()
  await expect(page.getByTestId('metric-power')).not.toContainText('—')
  const first = await page.getByTestId('metric-power').textContent()
  await expect.poll(() => page.getByTestId('metric-power').textContent()).not.toBe(first)
  await expect(page.locator('.recharts-area-curve').first()).toBeVisible()
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true })
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  const routes = [
    ['/live', 'Live monitoring'],
    ['/consumption', 'Consumption'],
    ['/insights', 'Predictions'],
    ['/alerts', 'Alerts & events'],
    ['/history', 'Historical data'],
    ['/reports', 'Energy reports'],
    ['/device', 'Device status'],
    ['/settings', 'Settings'],
  ]
  for (const [path, title] of routes) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await expect(page.locator('.error-state')).toHaveCount(0)
  }
  await page.goto('/history')
  await expect(page.locator('tbody tr').first()).toBeVisible()
  await page.getByLabel('Date range', { exact: true }).selectOption('week')
  await expect(page.locator('tbody tr').first()).toBeVisible()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
  expect((await downloading).suggestedFilename()).toBe('power-readings.csv')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByTestId('metric-power')).not.toContainText('—')
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true })
  for (const [path] of [['/'], ...routes]) {
    await page.goto(path)
    await expect(page.locator('h1')).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy()
  }
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Energy overview' })).toBeVisible()
  expect(errors).toEqual([])
})

test('settings persist and trigger an actionable alert', async ({ page, request }) => {
  const original = await (await request.get('/api/settings')).json()
  try {
    await page.goto('/settings')
    await expect(page.getByLabel('Maximum active power', { exact: true })).toHaveValue(
      String(original.max_power),
    )
    await page.getByLabel('Maximum active power', { exact: true }).fill('50')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(
      page.getByText('Settings saved. New thresholds apply to the next reading.'),
    ).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('Maximum active power', { exact: true })).toHaveValue('50')
    await page.goto('/alerts')
    await expect(page.getByRole('heading', { name: 'High Power', exact: true })).toBeVisible()
    const card = page
      .locator('.alert-card')
      .filter({ has: page.getByRole('heading', { name: 'High Power', exact: true }) })
      .first()
    await card.getByRole('button', { name: 'Acknowledge' }).click()
    await expect(card.getByText('Acknowledged', { exact: true })).toBeVisible()
    await card.getByRole('button', { name: 'Resolve', exact: true }).click()
  } finally {
    await request.put('/api/settings', { data: original })
  }
})

test('connection becomes stale then reconnects automatically', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('metric-power')).not.toContainText('—')
  await page.context().setOffline(true)
  await expect(
    page.locator('.topbar').getByText('Data connection lost', { exact: true }),
  ).toBeVisible({ timeout: 18000 })
  await page.context().setOffline(false)
  await expect(page.locator('.topbar').getByText('Live', { exact: true })).toBeVisible({
    timeout: 18000,
  })
})
