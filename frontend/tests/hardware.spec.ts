import { expect, test } from '@playwright/test'

test('hardware workspace waits for actual input without showing demo data', async ({
  page,
  request,
}) => {
  const health = await (await request.get('/api/health')).json()
  test.skip(health.source !== 'hardware', 'Requires hardware mode.')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.locator('.source-card strong')).toHaveText('Hardware source')
  await expect(page.locator('.section-kicker')).toContainText('Hardware source')
  await expect(page.getByText('Demo data source', { exact: true })).toHaveCount(0)
  if (health.reading_count === 0) {
    await expect(page.getByTestId('metric-power')).toContainText('—')
    await expect(page.getByRole('heading', { name: 'Waiting for readings' })).toBeVisible()
    await expect(
      page.locator('.topbar').getByText('Data connection lost', { exact: true }),
    ).toBeVisible({ timeout: 16000 })
  }
  await page.goto('/device')
  await expect(page.getByText('HARDWARE INPUT ADAPTER', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy()
  await page.screenshot({ path: 'test-results/hardware-device-mobile.png', fullPage: true })
  expect(errors).toEqual([])
})
