import type { Alert, Device, Reading, Settings } from '../types'
interface Snapshot {
  points: Reading[]
  alerts: Alert[]
}
export function offlineResource(
  path: string,
  session: Snapshot,
  settings: Settings,
  device: Device | null,
): unknown {
  const url = new URL(path, 'https://offline.invalid')
  if (url.pathname === '/settings') return settings
  if (url.pathname === '/health') return device
  if (url.pathname === '/alerts') {
    const status = url.searchParams.get('status'),
      severity = url.searchParams.get('severity')
    const start = url.searchParams.get('start'),
      end = url.searchParams.get('end')
    const offset = Number(url.searchParams.get('offset') || 0),
      limit = Number(url.searchParams.get('limit') || 25)
    return session.alerts
      .filter(
        (a) =>
          (!status || (status === 'open' ? a.status !== 'resolved' : a.status === status)) &&
          (!severity || a.severity === severity) &&
          (!start || a.timestamp >= start) &&
          (!end || a.timestamp < end),
      )
      .slice(offset, offset + limit)
  }
  if (url.pathname === '/predictions')
    return {
      status: 'not_configured',
      model_version: null,
      predictions: [],
      message: 'Cloud unavailable.',
    }
  if (url.pathname === '/history/trend' || url.pathname === '/history') {
    const range = url.searchParams.get('range') || 'today'
    const now = Date.now(),
      midnight = new Date().setHours(0, 0, 0, 0)
    const start =
      range === 'custom'
        ? Date.parse(url.searchParams.get('start') || '')
        : range === '1m'
          ? now - 60000
          : range === '10m'
            ? now - 600000
            : range === '1h'
              ? now - 3600000
              : range === 'today'
                ? midnight
                : range === 'yesterday'
                  ? midnight - 86400000
                  : range === 'week'
                    ? midnight - 6 * 86400000
                    : midnight - 29 * 86400000
    const end =
      range === 'custom'
        ? Date.parse(url.searchParams.get('end') || '')
        : range === 'yesterday'
          ? midnight
          : now + 1
    const rows = session.points.filter(
      (p) => Date.parse(p.timestamp) >= start && Date.parse(p.timestamp) < end,
    )
    if (url.pathname.endsWith('/trend')) {
      const max = Number(url.searchParams.get('points') || 240)
      return rows.filter(
        (_, i) => i % Math.max(1, Math.ceil(rows.length / max)) === 0 || i === rows.length - 1,
      )
    }
    const page = Number(url.searchParams.get('page') || 1),
      size = Number(url.searchParams.get('page_size') || 20)
    return {
      items: [...rows].reverse().slice((page - 1) * size, page * size),
      total: rows.length,
      page,
      page_size: size,
    }
  }
  throw new Error(
    'This view needs cloud history. Live measurements, session history and local alerts remain available over Bluetooth.',
  )
}
