import { expect, test, type WebSocketRoute } from '@playwright/test'
import { workspace } from './helpers/cloud'
import { mockBluetooth, notify } from './helpers/bluetooth'

test('cloud priority, Render outage, BLE disconnect, and automatic cloud recovery share one dashboard', async ({
  page,
}) => {
  await mockBluetooth(page)
  const cloud = { enabled: true, sockets: [] as WebSocketRoute[] }
  const requests = await workspace(page, false, cloud)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expect(page.getByTestId('metric-power')).toContainText('393.8')
  await page.getByRole('button', { name: 'Connect Offline Device' }).click()
  await expect(page.getByText('Bluetooth standby', { exact: true })).toBeVisible()
  await notify(page, 93.2)
  await expect(page.getByTestId('metric-power')).toContainText('393.8')
  cloud.enabled = false
  for (const socket of cloud.sockets) socket.close({ code: 1013 })
  await expect(page.getByText('OFFLINE DEVICE MODE', { exact: true })).toBeVisible()
  await notify(page, 93.2)
  await expect(page.getByTestId('metric-power')).toContainText('93.2')
  await expect(
    page.getByText('Live via Bluetooth • Cloud unavailable', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('.budget-panel')).toContainText('Monthly total needs cloud')
  await page.evaluate(() =>
    (window as any).bleTest.send('{"v":231,"i":-1,"p":9999,"e":1,"f":50,"pf":0.9}'),
  )
  await expect(page.getByTestId('metric-power')).toContainText('93.2')
  await page.evaluate(() => (window as any).bleTest.disconnect())
  await expect(page.getByText('Device disconnected', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Reconnect device' }).click()
  await notify(page, 120)
  await expect(page.getByTestId('metric-power')).toContainText('120.0')
  expect(await page.evaluate(() => (window as any).bleTest.stats())).toEqual({
    connects: 2,
    starts: 2,
  })
  cloud.enabled = true
  await expect(page.getByText('Live • Synced', { exact: true })).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('metric-power')).toContainText('393.8')
  await notify(page, 2500)
  await expect(page.getByTestId('metric-power')).toContainText('393.8')
  expect(requests.some((r) => r.path === '/readings' || r.method !== 'GET')).toBeFalsy()
  expect(errors).toEqual([])
})

test('local alerts and controls never mutate cloud state', async ({ page }) => {
  await mockBluetooth(page)
  const requests = await workspace(page, true)
  await page.goto('/')
  await page.getByRole('button', { name: 'Connect Offline Device' }).click()
  await expect(page.getByText('Bluetooth connected', { exact: true })).toBeVisible()
  await notify(page, 2500)
  await expect(page.getByTestId('metric-power')).toContainText('2,500.0')
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Alerts', exact: false })
    .click()
  await page.getByRole('button', { name: 'Acknowledge', exact: true }).click()
  await expect(page.getByText('Acknowledged', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Resolve', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'All clear. You’re in good shape.' }),
  ).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Settings' })
    .click()
  await expect(page.getByLabel('Electricity tariff', { exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'History' })
    .click()
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
  await expect(page.locator('tbody tr')).toHaveCount(1)
  expect(requests.some((r) => r.method !== 'GET')).toBeFalsy()
})

test('PWA reloads offline with unvisited routes and connects without network', async ({
  page,
  context,
}) => {
  await mockBluetooth(page)
  const requests = await workspace(page)
  await page.goto('/')
  await expect(page.getByText('App ready offline', { exact: true })).toBeVisible({ timeout: 20000 })
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBeTruthy()
  await expect(page.getByTestId('metric-power')).toContainText('393.8')
  await context.setOffline(true)
  await page.route('**/api/**', (route) => route.abort('internetdisconnected'))
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Energy overview' })).toBeVisible()
  await page.getByRole('button', { name: 'Connect Offline Device' }).click()
  await expect(page.getByText('Bluetooth connected', { exact: true })).toBeVisible()
  await notify(page)
  await expect(page.getByTestId('metric-power')).toContainText('93.2')
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Live monitoring' })
    .click()
  await expect(page.getByRole('heading', { name: 'Live monitoring', exact: true })).toBeVisible()
  await expect(page.getByTestId('metric-voltage')).toContainText('231.8')
  // A direct nested-route navigation also resolves from the precached shell.
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  const cacheUrls = await page.evaluate(async () => {
    const cachesKeys = await caches.keys()
    const urls: string[] = []
    for (const key of cachesKeys)
      for (const request of await (await caches.open(key)).keys()) urls.push(request.url)
    return urls
  })
  expect(cacheUrls.some((url) => url.includes('/api/'))).toBeFalsy()
  expect(cacheUrls.some((url) => url.endsWith('.woff2'))).toBeTruthy()
  expect(cacheUrls.some((url) => url.includes('LiveMonitoring-'))).toBeTruthy()
  expect(requests.some((r) => r.method !== 'GET')).toBeFalsy()
})

test('cancelled selection and unsupported browsers keep cloud working', async ({ page }) => {
  await mockBluetooth(page)
  await workspace(page)
  await page.goto('/')
  await page.evaluate(() => (window as any).bleTest.cancel())
  await page.getByRole('button', { name: 'Connect Offline Device' }).click()
  await expect(page.getByText('Device selection cancelled.', { exact: true })).toBeVisible()
  await expect(page.getByTestId('metric-power')).toContainText('393.8')
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'bluetooth', { value: undefined, configurable: true }),
  )
  await page.reload()
  await expect(page.getByRole('button', { name: 'Connect Offline Device' })).toBeDisabled()
  await expect(page.getByText(/This browser does not support Web Bluetooth/)).toBeVisible()
  await expect(page.getByTestId('metric-power')).toContainText('393.8')
})

test('previously authorized device reconnects without a picker and respects manual disconnect', async ({
  page,
}) => {
  await mockBluetooth(page)
  await page.addInitScript(() => localStorage.setItem('wattwise-ble-device', 'test-power-meter'))
  await workspace(page, true)
  await page.goto('/')
  await expect(page.getByText('Bluetooth connected', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).bleTest.pickerCount())).toBe(0)
  await notify(page, 88)
  await expect(page.getByTestId('metric-power')).toContainText('88.0')
  await page.evaluate(() => (window as any).bleTest.disconnect())
  await expect(page.getByText('Bluetooth connected', { exact: true })).toBeVisible({
    timeout: 7000,
  })
  await notify(page, 89)
  await expect(page.getByTestId('metric-power')).toContainText('89.0')
  await page.getByRole('button', { name: 'Disconnect Bluetooth' }).click()
  await expect(page.getByText('Device disconnected', { exact: true })).toBeVisible()
  await page.waitForTimeout(5500)
  expect(await page.evaluate(() => (window as any).bleTest.stats())).toEqual({
    connects: 2,
    starts: 2,
  })
})

test('an open WebSocket with stale readings yields to BLE and fresh data restores cloud', async ({
  page,
}) => {
  await mockBluetooth(page)
  const cloud = { enabled: true, sockets: [] as WebSocketRoute[], paused: false }
  await workspace(page, false, cloud)
  await page.goto('/')
  await expect(page.getByText('Live • Synced', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Connect Offline Device' }).click()
  await expect(page.getByText('Bluetooth standby', { exact: true })).toBeVisible()
  cloud.paused = true
  const timer = setInterval(() => void notify(page, 77).catch(() => {}), 700)
  try {
    await expect(
      page.getByText('Live via Bluetooth • Cloud unavailable', { exact: true }),
    ).toBeVisible({ timeout: 13000 })
    await expect(page.getByTestId('metric-power')).toContainText('77.0')
    await page.screenshot({
      path: 'test-results/offline-bluetooth-desktop.png',
      fullPage: true,
      animations: 'disabled',
    })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await page.screenshot({
      path: 'test-results/offline-bluetooth-mobile.png',
      fullPage: true,
      animations: 'disabled',
    })
    cloud.paused = false
    await expect(page.getByText('Live • Synced', { exact: true })).toBeVisible()
    await expect(page.getByTestId('metric-power')).toContainText('393.8')
  } finally {
    clearInterval(timer)
  }
})
