import { expect, test, type Page } from '@playwright/test'
import { deviceTotals, estimatedPower, validateDevice } from '../src/types/device'
import type { InventoryDevice } from '../src/types/device'
import { workspace } from './helpers/cloud'
import { mockBluetooth, notify } from './helpers/bluetooth'

async function records(page: Page, name = 'wattwise-devices', store = 'devices') {
  return page.evaluate(
    async ({ name, store }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, 1)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        return await new Promise<any[]>((resolve, reject) => {
          const tx = db.transaction(store)
          const request = tx.objectStore(store).getAll()
          tx.oncomplete = () => resolve(request.result)
          tx.onabort = () => reject(tx.error)
        })
      } finally {
        db.close()
      }
    },
    { name, store },
  )
}
async function add(
  page: Page,
  name: string,
  category = 'light',
  quantity = 4,
  active = 3,
  power = 12,
) {
  await page.getByRole('button', { name: 'Add Device', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Add Device', exact: true })
  await modal.getByLabel('Device Name', { exact: true }).fill(name)
  await modal.getByRole('combobox', { name: 'Category', exact: true }).selectOption(category)
  await modal.getByLabel('Room', { exact: true }).fill('Living room')
  await modal.getByLabel('Quantity', { exact: true }).fill(String(quantity))
  await modal.getByLabel('Active Quantity', { exact: true }).fill(String(active))
  await modal.getByLabel('Rated Power (W)', { exact: true }).fill(String(power))
  await modal.getByRole('button', { name: 'Add Device', exact: true }).click()
  await expect(modal).toHaveCount(0)
}
const sample: InventoryDevice = {
  id: 'light',
  name: 'Hall Lights',
  category: 'light',
  room: 'Hall',
  quantity: 4,
  activeQuantity: 3,
  ratedPowerW: 12,
  monitoringType: 'estimated',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
}

test('device validation and physical unit totals distinguish unknown and zero measured load', () => {
  expect(validateDevice(sample)).toEqual({})
  expect(estimatedPower(sample)).toBe(36)
  expect(deviceTotals([sample], 50)).toEqual({
    total: 4,
    active: 3,
    knownLoadW: 36,
    unassignedLoadW: 14,
  })
  expect(deviceTotals([sample], 0).unassignedLoadW).toBe(0)
  expect(deviceTotals([sample], null).unassignedLoadW).toBeNull()
  expect(deviceTotals([{ ...sample, activeQuantity: 0 }], 50).knownLoadW).toBe(0)
  for (const patch of [
    { name: '   ' },
    { quantity: 0 },
    { quantity: 1.5 },
    { activeQuantity: -1 },
    { activeQuantity: 5 },
    { activeQuantity: 0.5 },
    { ratedPowerW: -1 },
    { ratedPowerW: NaN },
  ])
    expect(Object.keys(validateDevice({ ...sample, ...patch })).length).toBeGreaterThan(0)
})

test('add, edit, delete, category filters and active controls persist without cloud mutations', async ({
  page,
}) => {
  const requests = await workspace(page)
  await page.goto('/devices')
  await expect(page.getByRole('heading', { name: 'Devices', exact: true, level: 1 })).toBeVisible()
  await expect(page.locator('.inventory-stat').nth(3)).toContainText('393.8 W')
  await add(page, 'Hall Lights')
  await expect(page.locator('.inventory-stat').nth(0)).toContainText('4')
  await expect(page.locator('.inventory-stat').nth(1)).toContainText('3')
  await expect(page.locator('.inventory-stat').nth(2)).toContainText('36.0 W')
  await expect(page.locator('.inventory-comparison')).toContainText('357.8 W')
  await page.getByRole('button', { name: 'Increase active quantity for Hall Lights' }).click()
  await expect(
    page.getByRole('button', { name: 'Increase active quantity for Hall Lights' }),
  ).toBeDisabled()
  await expect(page.getByRole('article', { name: 'Hall Lights' })).toContainText('48.0 W')
  await page.getByRole('button', { name: 'Decrease active quantity for Hall Lights' }).click()
  await add(page, 'Bedroom Fan', 'fan', 1, 1, 75)
  await add(page, 'Living Room AC', 'ac', 1, 1, 1500)
  await expect(page.locator('.inventory-stat').nth(2)).toContainText('1.61 kW')
  await expect(page.locator('.inventory-comparison dl > div').nth(2)).toContainText('0.0 W')
  await expect(page.getByText(/Configured estimates exceed/)).toBeVisible()
  await page.getByRole('switch', { name: 'Active state for Living Room AC' }).click()
  await expect(page.locator('.inventory-stat').nth(2)).toContainText('111.0 W')
  await page.getByRole('button', { name: 'Fans', exact: true }).click()
  await expect(page.getByRole('article')).toHaveCount(1)
  await expect(page.getByRole('article', { name: 'Bedroom Fan' })).toBeVisible()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await expect.poll(async () => (await records(page)).length).toBe(3)
  const before = (await records(page)).find((d) => d.name === 'Bedroom Fan')
  await page.getByRole('button', { name: 'Edit Bedroom Fan', exact: true }).click()
  const edit = page.getByRole('dialog', { name: 'Edit Device' })
  await edit.getByLabel('Device Name', { exact: true }).fill('Desk Fan')
  await edit.getByLabel('Rated Power (W)', { exact: true }).fill('60')
  await edit.getByRole('button', { name: 'Save changes' }).click()
  await expect
    .poll(async () => (await records(page)).find((d) => d.id === before.id)?.ratedPowerW)
    .toBe(60)
  const after = (await records(page)).find((d) => d.id === before.id)
  expect(after.createdAt).toBe(before.createdAt)
  expect(Date.parse(after.updatedAt)).toBeGreaterThanOrEqual(Date.parse(before.updatedAt))
  await page.reload()
  await expect(page.getByRole('article', { name: 'Desk Fan' })).toContainText('60.0 W')
  await page.getByRole('button', { name: 'Delete Desk Fan', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Delete Device' })
    .getByRole('button', { name: 'Cancel' })
    .click()
  await expect(page.getByRole('article', { name: 'Desk Fan' })).toBeVisible()
  await page.getByRole('button', { name: 'Delete Desk Fan', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Delete Device' })
    .getByRole('button', { name: 'Delete Device', exact: true })
    .click()
  await expect(page.getByRole('article', { name: 'Desk Fan' })).toHaveCount(0)
  await expect.poll(async () => (await records(page)).length).toBe(2)
  await page.reload()
  await expect(page.getByRole('article')).toHaveCount(2)
  expect(requests.some((r) => r.method !== 'GET')).toBeFalsy()
})

test('modal validates quantities and rating, traps focus and restores keyboard focus', async ({
  page,
}) => {
  await workspace(page, true)
  await page.goto('/devices')
  await page.getByRole('button', { name: 'Add Device', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Add Device', exact: true })
  await expect(modal.getByLabel('Device Name', { exact: true })).toBeFocused()
  await expect(modal.getByLabel('Monitoring Type')).toHaveValue('estimated')
  await expect(modal.locator('option[value="metered"]')).toHaveJSProperty('disabled', true)
  await modal.getByRole('button', { name: 'Add Device', exact: true }).click()
  await expect(modal.getByText('Enter a device name.', { exact: true })).toBeVisible()
  await modal.locator('#device-field-name').fill('Hall Lights')
  await modal.locator('#device-field-quantity').fill('2')
  await modal.locator('#device-field-activeQuantity').fill('3')
  await modal.locator('#device-field-ratedPowerW').fill('-1')
  await modal.getByRole('button', { name: 'Add Device', exact: true }).click()
  await expect(modal.getByText('Active quantity cannot exceed quantity.')).toBeVisible()
  await expect(modal.getByText('Enter a valid rated power of 0 W or more.')).toBeVisible()
  expect(await records(page)).toHaveLength(0)
  await modal.locator('#device-field-activeQuantity').fill('1')
  await modal.locator('#device-field-ratedPowerW').fill('12')
  await modal.getByRole('button', { name: 'Add Device', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(modal.getByRole('button', { name: 'Close dialog' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(modal.getByRole('button', { name: 'Add Device', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(modal).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add Device', exact: true })).toBeFocused()
})

test('stale cloud readings become unavailable without losing the inventory estimate', async ({
  page,
}) => {
  const cloud = { enabled: true, sockets: [] as any[], paused: false }
  await workspace(page, false, cloud)
  await page.goto('/devices')
  await add(page, 'Desk Fan', 'fan', 1, 1, 75)
  await expect(page.locator('.inventory-stat').nth(3)).toContainText('393.8 W')
  cloud.paused = true
  await expect(page.locator('.inventory-stat').nth(3)).toContainText('Metered load unavailable')
  await expect(page.locator('.inventory-stat').nth(2)).toContainText('75.0 W')
  await expect(page.locator('.inventory-comparison dl > div').nth(2)).toContainText('—')
  cloud.paused = false
  await expect(page.locator('.inventory-stat').nth(3)).toContainText('393.8 W')
  await expect(page.locator('.inventory-comparison dl > div').nth(2)).toContainText('318.8 W')
})

test('cached PWA keeps inventory offline and uses the existing BLE reading without touching reading storage', async ({
  page,
  context,
}) => {
  await mockBluetooth(page)
  await workspace(page, true)
  await page.goto('/')
  await expect(page.getByText('App ready offline', { exact: true })).toBeVisible()
  await page.reload()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBeTruthy()
  // Devices is an unvisited lazy route when the internet is disabled.
  await context.setOffline(true)
  await page.goto('/devices')
  await expect(page.getByText('Metered load unavailable').first()).toBeVisible()
  await add(page, 'Offline Fan', 'fan', 1, 1, 75)
  await expect.poll(async () => (await records(page)).length).toBe(1)
  await page.reload()
  await expect(page.getByRole('article', { name: 'Offline Fan' })).toBeVisible()
  await expect(page.locator('.inventory-stat').nth(2)).toContainText('75.0 W')
  await page.getByRole('button', { name: 'Connect Offline Device' }).click()
  await expect(page.getByText('Bluetooth connected', { exact: true })).toBeVisible()
  await notify(page, 100)
  await expect(page.locator('.inventory-stat').nth(3)).toContainText('100.0 W')
  await expect(page.locator('.inventory-comparison dl > div').nth(2)).toContainText('25.0 W')
  await expect
    .poll(async () => (await records(page, 'wattwise-offline', 'readings')).length)
    .toBe(1)
  const readingRows = await records(page, 'wattwise-offline', 'readings')
  await page.getByRole('switch', { name: 'Active state for Offline Fan' }).click()
  expect(await records(page, 'wattwise-offline', 'readings')).toEqual(readingRows)
  await page.getByRole('button', { name: 'Disconnect Bluetooth' }).click()
  await expect(page.locator('.inventory-stat').nth(3)).toContainText('Metered load unavailable')
  await expect(page.locator('.inventory-comparison dl > div').nth(2)).toContainText('—')
  await page.reload()
  await expect(page.getByRole('switch', { name: 'Active state for Offline Fan' })).not.toBeChecked()
})

for (const failure of ['open', 'write'] as const) {
  test(`inventory stays usable after IndexedDB ${failure} failure`, async ({ page }) => {
    await workspace(page, true)
    await page.addInitScript((failure) => {
      if (failure === 'open') {
        const open = IDBFactory.prototype.open
        IDBFactory.prototype.open = function (name, version) {
          if (name === 'wattwise-devices') throw new DOMException('Denied', 'SecurityError')
          return open.call(this, name, version)
        }
      } else {
        Object.assign(window, { inventoryQuotaFull: true })
        const transaction = IDBDatabase.prototype.transaction
        IDBDatabase.prototype.transaction = function (...args: Parameters<typeof transaction>) {
          if (
            this.name === 'wattwise-devices' &&
            args[1] === 'readwrite' &&
            (window as any).inventoryQuotaFull
          )
            throw new DOMException('Full', 'QuotaExceededError')
          return transaction.apply(this, args)
        }
      }
    }, failure)
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/devices')
    await add(page, 'Local Fan', 'fan', 1, 0, 50)
    await expect(page.getByText(/Device storage unavailable/)).toBeVisible()
    await page.getByRole('switch', { name: 'Active state for Local Fan' }).click()
    await expect(page.locator('.inventory-stat').nth(2)).toContainText('50.0 W')
    if (failure === 'write') {
      await page.evaluate(() => {
        ;(window as any).inventoryQuotaFull = false
      })
      await add(page, 'Local Light', 'light', 1, 1, 12)
      await expect.poll(async () => (await records(page)).length).toBe(2)
      await expect(page.getByText(/Device storage unavailable/)).toHaveCount(0)
      await page.reload()
      await expect(page.getByRole('article')).toHaveCount(2)
    }
    expect(errors).toEqual([])
  })
}

test('device cards and form retain the current design across desktop, tablet and mobile', async ({
  page,
}) => {
  await workspace(page)
  await page.goto('/devices')
  await add(page, 'Hall Lights')
  await add(page, 'Bedroom Fan', 'fan', 1, 1, 75)
  await add(page, 'Living Room AC', 'ac', 1, 1, 1500)
  for (const width of [1800, 1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    for (const card of await page.getByRole('article').all()) {
      expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy()
    }
    await page.screenshot({
      path: `test-results/devices-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
  }
  await page.getByRole('button', { name: 'Add Device', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Add Device', exact: true })
  expect(await modal.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy()
  await page.screenshot({ path: 'test-results/devices-form-mobile.png', animations: 'disabled' })
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: 'Add Device', exact: true }).click()
  await page.screenshot({ path: 'test-results/devices-form-desktop.png', animations: 'disabled' })
})
