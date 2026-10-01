import type { Reading, Summary } from '../types'

type SourceMode = 'cloud' | 'offline-device'

export interface ConsumptionForecast {
  observedMinutes: number
  averagePowerW: number
  recordedTodayKwh: number
  nextHourKwh: number
  nextHourCost: number
  projectedTodayKwh: number
  projectedTodayCost: number
  remainingHours: number
}

interface ForecastInput {
  readings: Reading[]
  latest: (Reading & { today?: Summary }) | null
  mode: SourceMode
  live: boolean
  tariff: number
  zone: string
  now: Date
}

export type ForecastResult =
  { forecast: ConsumptionForecast; reason: null } | { forecast: null; reason: string }

const formatters = new Map<string, Intl.DateTimeFormat>()
function localParts(stamp: number, zone: string) {
  let formatter = formatters.get(zone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    formatters.set(zone, formatter)
  }
  const parts = formatter.formatToParts(stamp)
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]))
}

function dateKey(stamp: number, zone: string) {
  const { year, month, day } = localParts(stamp, zone)
  return `${year}-${month}-${day}`
}

// Count only energy captured by this browser for the selected BLE meter.
// Gaps and duplicate timestamps establish a new baseline, matching OfflineSession.
export function capturedBleEnergy(readings: Reading[], zone: string, now: Date): number {
  const today = dateKey(now.getTime(), zone)
  const ordered = [...readings]
    .filter(
      (r) =>
        Number.isFinite(Date.parse(r.timestamp)) &&
        Date.parse(r.timestamp) <= now.getTime() &&
        Number.isFinite(r.energy) &&
        r.energy >= 0 &&
        dateKey(Date.parse(r.timestamp), zone) === today,
    )
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  let total = 0
  for (let i = 1; i < ordered.length; i++) {
    const seconds = (Date.parse(ordered[i].timestamp) - Date.parse(ordered[i - 1].timestamp)) / 1000
    if (seconds <= 0 || seconds >= 10) continue
    const delta = ordered[i].energy - ordered[i - 1].energy
    total += delta >= 0 ? delta : ordered[i].energy
  }
  return total
}

function recentAverage(readings: Reading[], source: string | undefined, now: number) {
  const byTime = new Map<number, number>()
  for (const row of readings) {
    const at = Date.parse(row.timestamp)
    if (
      Number.isFinite(at) &&
      at <= now + 5000 &&
      at >= now - 15 * 60 * 1000 &&
      Number.isFinite(row.power) &&
      row.power >= 0 &&
      (!source || !row.source || row.source === source)
    )
      byTime.set(at, row.power)
  }
  const rows = [...byTime].sort((a, b) => a[0] - b[0])
  if (!rows.length || now - rows[rows.length - 1][0] > 90000) return null
  // Do not average across a disconnect or a long gap in the recent sample window.
  let start = rows.length - 1
  while (start > 0 && rows[start][0] - rows[start - 1][0] <= 120000) start--
  if (rows.length - start < 3) return null
  const durationMs = rows[rows.length - 1][0] - rows[start][0]
  if (durationMs < 60000) return null
  let wattMilliseconds = 0
  for (let i = start + 1; i < rows.length; i++)
    wattMilliseconds += ((rows[i - 1][1] + rows[i][1]) / 2) * (rows[i][0] - rows[i - 1][0])
  return { powerW: wattMilliseconds / durationMs, minutes: durationMs / 60000 }
}

export function consumptionForecast({
  readings,
  latest,
  mode,
  live,
  tariff,
  zone,
  now,
}: ForecastInput): ForecastResult {
  if (!live || !latest) return { forecast: null, reason: 'Waiting for live meter readings.' }
  const at = Date.parse(latest.timestamp)
  if (!Number.isFinite(at) || now.getTime() - at > 90000 || at > now.getTime() + 5000)
    return { forecast: null, reason: 'The latest meter reading is no longer fresh.' }
  if (!Number.isFinite(tariff) || tariff < 0)
    return { forecast: null, reason: 'Set a valid electricity tariff to calculate cost.' }
  const average = recentAverage(readings, latest.source, now.getTime())
  if (!average) return { forecast: null, reason: 'Collect at least one minute of recent readings.' }
  const parts = localParts(now.getTime(), zone)
  const elapsedSeconds =
    Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)
  const remainingHours = (86400 - elapsedSeconds) / 3600
  const todayEnergy = latest.today?.energy_kwh
  if (mode === 'cloud' && (!Number.isFinite(todayEnergy) || (todayEnergy ?? -1) < 0))
    return { forecast: null, reason: 'Waiting for today’s recorded energy.' }
  const recordedTodayKwh =
    mode === 'cloud'
      ? todayEnergy!
      : Math.max(
          capturedBleEnergy(readings, zone, now),
          Number.isFinite(Date.parse(latest.today?.start || '')) &&
            dateKey(Date.parse(latest.today!.start), zone) === dateKey(now.getTime(), zone) &&
            Number.isFinite(todayEnergy) &&
            todayEnergy! >= 0
            ? todayEnergy!
            : 0,
        )
  const nextHourKwh = average.powerW / 1000
  const projectedTodayKwh = recordedTodayKwh + nextHourKwh * remainingHours
  return {
    reason: null,
    forecast: {
      observedMinutes: average.minutes,
      averagePowerW: average.powerW,
      recordedTodayKwh,
      nextHourKwh,
      nextHourCost: nextHourKwh * tariff,
      projectedTodayKwh,
      projectedTodayCost: projectedTodayKwh * tariff,
      remainingHours,
    },
  }
}
