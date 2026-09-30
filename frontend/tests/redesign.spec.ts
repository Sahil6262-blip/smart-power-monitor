import { expect, test, type Page } from '@playwright/test'

// Browser-only fixtures: no readings, alerts, or settings are written to the real backend.
async function workspace(page: Page, empty = false) {
  let settings = {
    tariff: 8,
    min_voltage: 210,
    max_voltage: 250,
    max_current: 10,
    max_power: 2000,
    min_power_factor: 0.85,
    monthly_energy_target: 250,
    sudden_power_increase: 700,
    connection_timeout_seconds: 10,
  }
  const now = Date.now()
  const summary = {
    start: new Date(now - 86400000).toISOString(),
    end: new Date(now).toISOString(),
    energy_kwh: 3.824,
    estimated_cost: 30.59,
    tariff: 8,
    average_power: 420,
    peak_power: 725,
    peak_time: new Date(now - 7200000).toISOString(),
    average_pf: 0.94,
    min_voltage: 228.1,
    max_voltage: 233.4,
    alert_count: 3,
    reading_count: 1258,
    source: 'hardware',
  }
  const readings = Array.from({ length: 60 }, (_, i) => ({
    id: i + 1,
    timestamp: new Date(now - (60 - i) * 1000).toISOString(),
    source: 'hardware',
    voltage: 230.4 + Math.sin(i / 8) * 1.4,
    current: 1.82 + Math.sin(i / 5) * 0.25,
    power: 393.8 + Math.sin(i / 6) * 135 + Math.cos(i / 2.1) * 22,
    energy: 48.201 + i / 10000,
    frequency: 50.01 + Math.sin(i / 5) * 0.03,
    power_factor: 0.94 + Math.sin(i / 9) * 0.02,
  }))
  const alerts = [
    {
      id: 1,
      timestamp: new Date(now - 3600000).toISOString(),
      type: 'high_power',
      severity: 'warning',
      message: 'Power exceeded your configured threshold.',
      measured_value: 2140,
      threshold_value: 2000,
      status: 'active',
      acknowledged_at: null,
      resolved_at: null,
    },
    {
      id: 2,
      timestamp: new Date(now - 7200000).toISOString(),
      type: 'low_power_factor',
      severity: 'warning',
      message: 'Power factor returned to its expected range.',
      measured_value: 0.81,
      threshold_value: 0.85,
      status: 'resolved',
      acknowledged_at: null,
      resolved_at: new Date(now - 7000000).toISOString(),
    },
  ]
  const requests: { method: string; path: string; body: unknown }[] = []
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname.replace('/api', '')
    requests.push({ method: req.method(), path: path + url.search, body: req.postDataJSON() })
    let data: unknown
    if (path === '/settings') {
      if (req.method() === 'PUT') settings = req.postDataJSON()
      data = settings
    } else if (path === '/health')
      data = {
        status: 'ok',
        database: 'connected',
        source: 'hardware',
        source_status: empty ? 'waiting' : 'live',
        last_reading: empty ? null : new Date().toISOString(),
        uptime_seconds: 9463,
        reading_count: empty ? 0 : 1258,
        active_alerts: empty ? 0 : 1,
        websocket_clients: 1,
        timezone: 'Asia/Kolkata',
        database_engine: 'SQLite',
        storage_bytes: 2400000,
        error: null,
      }
    else if (path.endsWith('/export')) {
      await route.fulfill({
        contentType: 'text/csv',
        body: 'timestamp,power\n2026-09-30T10:00:00Z,393.8\n',
      })
      return
    } else if (path === '/history/trend') data = empty ? [] : readings
    else if (path === '/history') {
      const pageNumber = Number(url.searchParams.get('page') || 1)
      data = {
        items: empty ? [] : readings.slice((pageNumber - 1) * 20, pageNumber * 20),
        total: empty ? 0 : 60,
        page: pageNumber,
        page_size: 20,
      }
    } else if (path.startsWith('/consumption/'))
      data = {
        summary,
        buckets: empty
          ? []
          : Array.from({ length: 24 }, (_, i) => ({
              timestamp: new Date(now - (24 - i) * 3600000).toISOString(),
              energy_kwh: 0.08 + Math.abs(Math.sin(i / 4)) * 0.28,
              estimated_cost: 1.6,
            })),
      }
    else if (path === '/reports') data = summary
    else if (path === '/predictions')
      data = {
        status: 'not_configured',
        model_version: null,
        predictions: [],
        message: 'No model connected.',
      }
    else if (path.startsWith('/alerts/')) {
      const alert = alerts.find((a) => a.id === Number(path.split('/').at(-1)))!
      Object.assign(alert, req.postDataJSON())
      data = alert
    } else if (path === '/alerts') {
      const status = url.searchParams.get('status')
      data = empty
        ? []
        : alerts.filter((a) =>
            status === 'open' ? a.status !== 'resolved' : status ? a.status === status : true,
          )
    } else {
      throw new Error('Unexpected fixture endpoint: ' + path)
    }
    await route.fulfill({ json: data })
  })
  await page.routeWebSocket('**/ws/live', (socket) => {
    if (empty) return
    const send = () =>
      socket.send(
        JSON.stringify({
          ...readings.at(-1),
          power: 393.8,
          timestamp: new Date().toISOString(),
          type: 'reading',
          system_status: 'normal',
          alerts: [],
          active_alert_count: alerts.filter((a) => a.status !== 'resolved').length,
          health_score: {
            score: 96,
            label: 'Excellent',
            description: 'Application heuristic.',
            factors: [{ name: 'Power factor', penalty: 4 }],
          },
          today: summary,
          budget: { target: 250, used: 108, remaining: 142, percentage: 43.2 },
          storage_status: 'connected',
        }),
      )
    send()
    const timer = setInterval(send, 1000)
    socket.onClose(() => clearInterval(timer))
  })
  return requests
}

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
