import { expect, test, type Page, type WebSocketRoute } from '@playwright/test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { workspace } from './helpers/cloud'
import { mockBluetooth, notify } from './helpers/bluetooth'

async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('wattwise-offline', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<any[]>((resolve, reject) => {
        const tx = db.transaction('readings', 'readonly')
        const request = tx.objectStore('readings').getAll()
        tx.oncomplete = () => resolve(request.result)
        tx.onabort = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  })
}

test('BLE history persists through offline reload/reopen and remains unsynced after cloud recovery', async ({
  page,
  context,
}) => {
  await mockBluetooth(page)
  const cloud = { enabled: false, sockets: [] as WebSocketRoute[] }
  const requests = await workspace(page, false, cloud)
  await page.goto('/')
  await expect(page.getByText('App ready offline', { exact: true })).toBeVisible()
  await page.reload()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBeTruthy()
  await page.getByRole('button', { name: 'Connect Offline Device' }).click()
  await expect(page.getByText('Bluetooth connected', { exact: true })).toBeVisible()
  await context.setOffline(true)
  await notify(page, 93.2, 0.023)
  await notify(page, 125.4, 0.024)
  await expect(page.getByTestId('metric-power')).toContainText('125.4')
  await expect.poll(async () => (await stored(page)).length).toBe(2)
  const records = await stored(page)
  expect(records.every((r) => r.source === 'ble' && r.synced === false)).toBeTruthy()
  expect(records.find((r) => r.power === 125.4)).toMatchObject({
    voltage: 231.8,
    current: 0.42,
    energy: 0.024,
    frequency: 50,
    power_factor: 0.96,
    deviceId: 'test-power-meter',
    timestamp: expect.any(String),
  })
  // Reopen without a usable radio: stored history must not require a BLE connection.
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'bluetooth', { value: undefined, configurable: true }),
  )
  await page.reload()
  await expect(page.getByText('OFFLINE DEVICE MODE', { exact: true })).toBeVisible()
  await expect(
    page.getByText('Live via Bluetooth • Cloud unavailable', { exact: true }),
  ).toHaveCount(0)
  await expect(page.locator('.chart-footer')).toContainText('Bluetooth session')
  await page.goto('/history')
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await expect(page.locator('tbody')).toContainText('125.4')
  await expect(page.locator('tbody')).toContainText('93.2')
  const reopened = await context.newPage()
  await reopened.goto('/history')
  await expect(reopened.locator('tbody tr')).toHaveCount(2)
  await reopened.close()
  cloud.enabled = true
  await context.setOffline(false)
  await expect(page.getByText('Live • Synced', { exact: true })).toBeVisible({ timeout: 15000 })
  expect(await stored(page)).toEqual(records)
  expect(requests.some((r) => r.method !== 'GET')).toBeFalsy()
})

for (const failure of ['open', 'write'] as const) {
  test(`IndexedDB ${failure} failure does not interrupt BLE rendering or in-memory history`, async ({
    page,
  }) => {
    await mockBluetooth(page)
    await workspace(page, true)
    await page.addInitScript((failure) => {
      if (failure === 'open') {
        Object.defineProperty(window, 'indexedDB', {
          get() {
            throw new DOMException('Storage denied', 'SecurityError')
          },
        })
      } else {
        const transaction = IDBDatabase.prototype.transaction
        IDBDatabase.prototype.transaction = function (...args: Parameters<typeof transaction>) {
          if (args[1] === 'readwrite') throw new DOMException('Storage full', 'QuotaExceededError')
          return transaction.apply(this, args)
        }
      }
    }, failure)
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/')
    await page.getByRole('button', { name: 'Connect Offline Device' }).click()
    await expect(page.getByText('Bluetooth connected', { exact: true })).toBeVisible()
    await notify(page, 81)
    await notify(page, 82)
    await expect(page.getByTestId('metric-power')).toContainText('82.0')
    await expect(page.getByText(/Reading storage unavailable/)).toBeVisible()
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'History' })
      .click()
    await expect(page.locator('tbody tr')).toHaveCount(2)
    expect(errors).toEqual([])
  })
}

test('real IndexedDB transactions deduplicate, retain newest 10,000, and isolate meters', async ({
  page,
}) => {
  await workspace(page, true)
  // Execute the actual storage module in Chromium; no fake IndexedDB dependency.
  const module = ts.transpileModule(readFileSync('src/services/offlineStorage.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  await page.route('**/__offlineStorage.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: module }),
  )
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const moduleUrl = '/__offlineStorage.js'
    const storage = await import(moduleUrl)
    await storage.loadOfflineReadings('meter-a')
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('wattwise-offline', 1)
      request.onsuccess = () => resolve(request.result)
    })
    const now = Date.now()
    const sample = {
      timestamp: new Date(now).toISOString(),
      source: 'ble',
      voltage: 231.8,
      current: 0.42,
      power: 93.2,
      energy: 0.023,
      frequency: 50,
      power_factor: 0.96,
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('readings', 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
      for (let i = 0; i < 10002; i++)
        tx.objectStore('readings').put({
          ...sample,
          key: 'seed-' + i,
          deviceId: 'meter-a',
          synced: false,
          timestamp: new Date(now - (10002 - i) * 1000).toISOString(),
        })
    })
    db.close()
    const saved = await Promise.all([
      storage.saveOfflineReading(sample, 'meter-a'),
      storage.saveOfflineReading(sample, 'meter-a'),
      storage.saveOfflineReading(sample, 'meter-b'),
    ])
    const rows = await storage.loadOfflineReadings('meter-a')
    const other = await storage.loadOfflineReadings('meter-b')
    return {
      saved,
      count: rows.length + other.length,
      other: other.length,
      duplicateCount: rows.filter((r: any) => r.timestamp === sample.timestamp).length,
      first: rows[0].timestamp,
      expectedFirst: new Date(now - (10002 - 4) * 1000).toISOString(),
      unsynced: [...rows, ...other].every((r: any) => r.synced === false && r.source === 'ble'),
    }
  })
  expect(result.saved).toEqual([true, true, true])
  expect(result.count).toBe(10000)
  expect(result.other).toBe(1)
  expect(result.duplicateCount).toBe(1)
  expect(result.first).toBe(result.expectedFirst)
  expect(result.unsynced).toBeTruthy()
})
