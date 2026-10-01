import { expect, test } from '@playwright/test'
import type { Reading, Summary } from '../src/types'
import {
  capturedBleEnergy,
  capturedBleMonthEnergy,
  consumptionForecast,
  monthlyForecast,
} from '../src/services/forecast'
import { workspace } from './helpers/cloud'
import { mockBluetooth, notify } from './helpers/bluetooth'

const now = new Date('2026-10-01T06:00:00Z') // 11:30 in Asia/Kolkata
const rows: Reading[] = Array.from({ length: 61 }, (_, i) => ({
  timestamp: new Date(now.getTime() - (60 - i) * 1000).toISOString(),
  source: 'hardware',
  voltage: 230,
  current: 0.5,
  power: 100,
  energy: 1 + i / 36000,
  frequency: 50,
  power_factor: 0.98,
}))
const latest = {
  ...rows[60],
  today: { energy_kwh: 0.35, start: '2026-09-30T18:30:00Z' } as Summary,
}

test('forecasts next-hour and end-of-day energy and cost from fresh measured power', () => {
  const result = consumptionForecast({
    readings: rows,
    latest,
    mode: 'cloud',
    live: true,
    tariff: 8,
    zone: 'Asia/Kolkata',
    now,
  })
  expect(result.reason).toBeNull()
  expect(result.forecast).toMatchObject({
    observedMinutes: 1,
    averagePowerW: 100,
    recordedTodayKwh: 0.35,
    nextHourKwh: 0.1,
    nextHourCost: 0.8,
    remainingHours: 12.5,
    projectedTodayKwh: 1.6,
    projectedTodayCost: 12.8,
  })
  const differentTariff = consumptionForecast({
    readings: rows,
    latest,
    mode: 'cloud',
    live: true,
    tariff: 10,
    zone: 'Asia/Kolkata',
    now,
  })
  expect(differentTariff.forecast?.projectedTodayCost).toBe(16)
  expect(differentTariff.forecast?.projectedTodayKwh).toBe(1.6)
})

test('projects monthly kWh and cost from recorded energy plus the current daily run rate', () => {
  const today = consumptionForecast({
    readings: rows,
    latest,
    mode: 'cloud',
    live: true,
    tariff: 8,
    zone: 'Asia/Kolkata',
    now,
  }).forecast
  const input = {
    today,
    monthEnergyKwh: 0.35,
    readings: rows,
    mode: 'cloud' as const,
    tariff: 8,
    zone: 'Asia/Kolkata',
    now,
  }
  expect(monthlyForecast(input)).toEqual({
    recordedMonthKwh: 0.35,
    projectedMonthKwh: 49.6,
    projectedMonthCost: 396.8,
    remainingFullDays: 30,
  })
  expect(
    monthlyForecast({ ...input, now: new Date('2026-10-31T06:00:00Z'), monthEnergyKwh: 40 }),
  ).toMatchObject({ remainingFullDays: 0, projectedMonthKwh: 41.25, projectedMonthCost: 330 })
  expect(monthlyForecast({ ...input, monthEnergyKwh: null })).toBeNull()
  expect(monthlyForecast({ ...input, today: null })).toBeNull()
  expect(monthlyForecast({ ...input, tariff: 0 })?.projectedMonthCost).toBe(0)
})

test('does not invent forecasts from missing, stale or interrupted meter data', () => {
  const input = {
    readings: rows,
    latest,
    mode: 'cloud' as const,
    live: true,
    tariff: 8,
    zone: 'Asia/Kolkata',
    now,
  }
  expect(consumptionForecast({ ...input, readings: rows.slice(-2) }).forecast).toBeNull()
  expect(consumptionForecast({ ...input, live: false }).forecast).toBeNull()
  expect(
    consumptionForecast({ ...input, now: new Date(now.getTime() + 120000) }).forecast,
  ).toBeNull()
  expect(
    consumptionForecast({
      ...input,
      readings: [
        { ...rows[0], timestamp: new Date(now.getTime() - 300000).toISOString() },
        { ...rows[1], timestamp: new Date(now.getTime() - 240000).toISOString() },
        rows[60],
      ],
    }).forecast,
  ).toBeNull()
  expect(
    consumptionForecast({ ...input, latest: { ...latest, today: undefined } }).forecast,
  ).toBeNull()
})

test('BLE energy counts captured counter deltas without attributing disconnected gaps', () => {
  const ble = rows.map((r) => ({ ...r, source: 'ble', energy: 0.01 + Number(r.energy) - 1 }))
  expect(capturedBleEnergy(ble, 'Asia/Kolkata', now)).toBeCloseTo(60 / 36000)
  expect(capturedBleMonthEnergy(ble, 'Asia/Kolkata', now)).toBeCloseTo(60 / 36000)
  const gapped = [ble[0], ble[1], { ...ble[60], energy: 0.1 }]
  expect(capturedBleEnergy(gapped, 'Asia/Kolkata', now)).toBeCloseTo(1 / 36000)
  const result = consumptionForecast({
    readings: ble,
    latest: { ...ble[60], today: { energy_kwh: 0, start: '2026-09-30T15:00:00Z' } as Summary },
    mode: 'offline-device',
    live: true,
    tariff: 8,
    zone: 'Asia/Kolkata',
    now,
  })
  expect(result.forecast?.recordedTodayKwh).toBeCloseTo(60 / 36000)
  expect(result.forecast?.projectedTodayKwh).toBeGreaterThan(1.25)
  expect(
    monthlyForecast({
      today: result.forecast,
      monthEnergyKwh: null,
      readings: ble,
      mode: 'offline-device',
      tariff: 8,
      zone: 'Asia/Kolkata',
      now,
    })?.projectedMonthKwh,
  ).toBeGreaterThan(38)
})

test('cloud forecast uses the existing live reading and remains in the current dashboard', async ({
  page,
}) => {
  const requests = await workspace(page)
  await page.goto('/insights')
  await expect(page.getByRole('heading', { name: 'AI insights', level: 1 })).toBeVisible()
  await expect(page.getByText('Forecast pending')).toHaveCount(0)
  await expect(page.locator('.forecast-card').first()).toContainText('kWh')
  await expect(page.locator('.forecast-card').nth(1)).toContainText('₹')
  await expect(page.locator('.forecast-breakdown')).toContainText('3.824 kWh')
  await expect(page.locator('.forecast-monthly-grid')).toContainText('kWh')
  await expect(page.locator('.forecast-monthly-grid')).toContainText('₹')
  expect(requests.some((r) => r.path === '/consumption/month?granularity=daily')).toBeTruthy()
  expect(requests.some((r) => r.path === '/predictions' || r.method !== 'GET')).toBeFalsy()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    await page.screenshot({
      path: `test-results/forecast-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
  }
})

test('BLE forecast uses persisted offline readings, then hides when the meter disconnects', async ({
  page,
}) => {
  await mockBluetooth(page)
  await workspace(page, true)
  await page.goto('/')
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('wattwise-offline', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('readings', 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
      const store = tx.objectStore('readings')
      for (let i = 0; i < 70; i++) {
        store.put({
          key: `forecast-${i}`,
          deviceId: 'test-power-meter',
          source: 'ble',
          synced: false,
          timestamp: new Date(Date.now() - (70 - i) * 1000).toISOString(),
          voltage: 231.8,
          current: 0.42,
          power: 93.2,
          energy: 0.01 + i * 0.00003,
          frequency: 50,
          power_factor: 0.96,
        })
      }
    })
    db.close()
  })
  await page.goto('/insights')
  await expect(page.getByText('Forecast pending')).toBeVisible()
  await page.getByRole('button', { name: 'Connect Offline Device' }).click()
  await notify(page, 93.2, 0.0122)
  await expect(page.locator('.forecast-card').first()).toContainText('0.093 kWh')
  await expect(page.locator('.forecast-breakdown')).toContainText('Captured today via Bluetooth')
  await expect(page.locator('.forecast-monthly-grid')).toContainText('kWh')
  await expect(page.locator('.forecast-monthly')).toContainText('Captured in this browser')
  await page.getByRole('button', { name: 'Disconnect Bluetooth' }).click()
  await expect(page.getByText('Forecast pending')).toBeVisible()
  await expect(page.locator('.forecast-monthly-grid')).toContainText('—')
})

test('AI insights keeps monthly numbers pending without live readings', async ({ page }) => {
  await workspace(page, true)
  await page.goto('/insights')
  await expect(page.getByRole('heading', { name: 'AI insights', level: 1 })).toBeVisible()
  await expect(page.locator('.forecast-monthly-grid')).toContainText('—')
  await expect(page.locator('.forecast-monthly')).toContainText('Waiting for live meter readings.')
})
