import type { Page, WebSocketRoute } from '@playwright/test'
// Browser-only fixtures: no readings, alerts, or settings are written to the real backend.
export async function workspace(
  page: Page,
  empty = false,
  cloud: { enabled: boolean; sockets: WebSocketRoute[]; paused?: boolean } = {
    enabled: true,
    sockets: [],
  },
) {
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
    cloud.sockets.push(socket)
    if (!cloud.enabled) {
      socket.close({ code: 1013 })
      return
    }
    if (empty) return
    const send = () => {
      if (cloud.paused) return
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
    }
    send()
    const timer = setInterval(send, 1000)
    socket.onClose(() => clearInterval(timer))
  })
  return requests
}
