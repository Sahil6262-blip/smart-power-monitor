import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import {
  CSV_HEADER,
  parseReadingCsv,
  readingCsv,
  readingFilename,
} from '../src/services/readingCsv'
import { workspace } from './helpers/cloud'
import { mockBluetooth, notify } from './helpers/bluetooth'

const row = {
  timestamp: '2026-10-01T05:12:15Z',
  voltage: 230.4,
  current: 1.235,
  power: 278.6,
  energy: 0.034,
  frequency: 50,
  power_factor: 0.98,
  source: 'hardware',
}
test('CSV uses exact columns, Kolkata date/time, numeric precision, ordering and escaping', () => {
  const earlier = { ...row, timestamp: '2026-09-30T18:30:00Z', energy: 0.000123, source: 'ble' }
  expect(readingCsv([row, earlier])).toBe(
    CSV_HEADER +
      '\r\n' +
      '01-10-2026,00:00:00,00,00,230.4,1.235,278.6,0.000123,50.0,0.98,ble\r\n' +
      '01-10-2026,10:42:15,10,42,230.4,1.235,278.6,0.034,50.0,0.98,hardware\r\n',
  )
  expect(readingCsv([row], 'UTC')).toContain('01-10-2026,05:12:15,05,12,')
  expect(readingCsv([{ ...row, source: 'a,"b"\nc' }])).toContain('"a,""b""\nc"')
  expect(readingCsv([])).toBe(CSV_HEADER + '\r\n')
  expect(readingFilename('Asia/Kolkata', new Date('2026-09-30T18:30:00Z'))).toBe(
    'smart-power-readings_01-10-2026.csv',
  )
})
test('backend CSV normalizes quoted fields and rejects malformed readings', () => {
  const csv =
    'timestamp,source,voltage,current,power,energy,frequency,power_factor\r\n' +
    '2026-10-01T05:12:15Z,"a,""b""\nc",230.4,1.235,278.6,0.034,50,0.98\r\n'
  expect(parseReadingCsv(csv)).toEqual([{ ...row, source: 'a,"b"\nc' }])
  expect(() => parseReadingCsv(csv.replace(',230.4,', ',,'))).toThrow('invalid reading')
  expect(() => readingCsv([{ ...row, timestamp: 'invalid' }])).toThrow('invalid timestamp')
})

test('existing cloud and persisted BLE export buttons download the same reading schema', async ({
  page,
}) => {
  await mockBluetooth(page)
  const cloud = { enabled: true, sockets: [] as any[] }
  const requests = await workspace(page, false, cloud)
  await page.goto('/history')
  const cloudDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  const file = await cloudDownload
  expect(file.suggestedFilename()).toMatch(/^smart-power-readings_\d{2}-\d{2}-\d{4}\.csv$/)
  const cloudText = await readFile((await file.path())!, 'utf8')
  expect(cloudText).toBe(
    CSV_HEADER + '\r\n30-09-2026,15:30:00,15,30,230.4,1.235,393.8,0.034,50.0,0.98,hardware\r\n',
  )
  cloud.enabled = false
  for (const socket of cloud.sockets) socket.close({ code: 1013 })
  await page.getByRole('button', { name: 'Connect Offline Device' }).click()
  await expect(page.getByText('Bluetooth connected', { exact: true })).toBeVisible()
  await notify(page, 93.2)
  // Wait for the async storage transaction before reloading.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const request = indexedDB.open('wattwise-offline', 1)
          request.onsuccess = () => resolve(request.result)
        })
        return new Promise<number>((resolve) => {
          const tx = db.transaction('readings')
          const request = tx.objectStore('readings').count()
          tx.oncomplete = () => {
            db.close()
            resolve(request.result)
          }
        })
      }),
    )
    .toBe(1)
  await page.reload()
  await expect(page.locator('tbody tr')).toHaveCount(1)
  const before = requests.length
  const offlineDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  const offlineText = await readFile((await (await offlineDownload).path())!, 'utf8')
  expect(offlineText.split('\r\n')[0]).toBe(CSV_HEADER)
  expect(offlineText).toMatch(/,231\.8,0\.420,93\.2,0\.023,50\.0,0\.96,ble\r\n$/)
  expect(requests.slice(before).some((r) => r.path.includes('/export'))).toBeFalsy()
})
