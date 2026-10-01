import type { Alert, Device, HealthScore, LiveMessage, Reading, Settings, Summary } from '../types'

export type DisplayReading = Omit<LiveMessage, 'budget'> & { budget?: LiveMessage['budget'] }
export class OfflineSession {
  points: Reading[] = []
  alerts: Alert[] = []
  latest: DisplayReading | null = null
  private previous: Reading | null = null
  private sequence = 0
  private alertSequence = 0
  private energy = 0
  private weightedPower = 0
  private seconds = 0
  private pfTotal = 0
  private count = 0
  private start = ''
  private peak?: Reading
  private minVoltage = Infinity
  private maxVoltage = 0
  disconnect() {
    this.previous = null
  }
  reset() {
    this.points = []
    this.alerts = []
    this.latest = null
    this.previous = null
    this.sequence = 0
    this.alertSequence = 0
    this.energy = 0
    this.weightedPower = 0
    this.seconds = 0
    this.pfTotal = 0
    this.count = 0
    this.start = ''
    this.peak = undefined
    this.minVoltage = Infinity
    this.maxVoltage = 0
  }
  ingest(input: Reading, settings: Settings): DisplayReading {
    const r = { ...input, id: ++this.sequence }
    if (!this.start) this.start = r.timestamp
    const interval = this.previous
      ? (Date.parse(r.timestamp) - Date.parse(this.previous.timestamp)) / 1000
      : 0
    // Gaps/reconnections establish a new baseline; never attribute unseen usage to this session.
    if (this.previous && interval > 0 && interval < 10) {
      this.energy += r.energy >= this.previous.energy ? r.energy - this.previous.energy : r.energy
      this.weightedPower += r.power * interval
      this.seconds += interval
    }
    this.count++
    this.pfTotal += r.power_factor
    if (!this.peak || r.power > this.peak.power) this.peak = r
    this.minVoltage = Math.min(this.minVoltage, r.voltage)
    this.maxVoltage = Math.max(this.maxVoltage, r.voltage)
    const sudden = this.previous && interval < 10 ? r.power - this.previous.power : 0
    const rules: [string, boolean, number, number, Alert['severity'], string][] = [
      [
        'high_voltage',
        r.voltage > settings.max_voltage,
        r.voltage,
        settings.max_voltage,
        'critical',
        'Voltage exceeds the configured upper limit.',
      ],
      [
        'low_voltage',
        r.voltage < settings.min_voltage,
        r.voltage,
        settings.min_voltage,
        'critical',
        'Voltage is below the configured lower limit.',
      ],
      [
        'high_current',
        r.current > settings.max_current,
        r.current,
        settings.max_current,
        'critical',
        'Current exceeds the configured load limit.',
      ],
      [
        'high_power',
        r.power > settings.max_power,
        r.power,
        settings.max_power,
        'warning',
        'Active power exceeds the configured limit.',
      ],
      [
        'low_power_factor',
        r.power_factor < settings.min_power_factor,
        r.power_factor,
        settings.min_power_factor,
        'warning',
        'Power factor is below the configured minimum.',
      ],
      [
        'sudden_power_increase',
        sudden > settings.sudden_power_increase,
        sudden,
        settings.sudden_power_increase,
        'info',
        'A sudden increase in active power was detected.',
      ],
    ]
    for (const [type, triggered, measured_value, threshold_value, severity, message] of rules) {
      const existing = this.alerts.find((a) => a.type === type && a.status !== 'resolved')
      if (triggered && !existing)
        this.alerts.unshift({
          id: ++this.alertSequence,
          timestamp: r.timestamp,
          type,
          measured_value,
          threshold_value,
          severity,
          message,
          status: 'active',
          acknowledged_at: null,
          resolved_at: null,
        })
      else if (!triggered && existing) {
        existing.status = 'resolved'
        existing.resolved_at = r.timestamp
      }
    }
    this.alerts = this.alerts.slice(0, 250)
    const active = this.alerts.filter((a) => a.status !== 'resolved').length
    const factors = [
      {
        name: 'Voltage range',
        penalty: r.voltage < settings.min_voltage || r.voltage > settings.max_voltage ? 25 : 0,
      },
      {
        name: 'Power factor',
        penalty: Math.round(
          Math.min(25, Math.max(0, settings.min_power_factor - r.power_factor) * 100),
        ),
      },
      {
        name: 'Load limit',
        penalty: r.power > settings.max_power || r.current > settings.max_current ? 20 : 0,
      },
      { name: 'Open session alerts', penalty: Math.min(20, active * 5) },
    ]
    const score = Math.max(0, 100 - factors.reduce((sum, f) => sum + f.penalty, 0))
    const health: HealthScore = {
      score,
      factors,
      label:
        score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 50 ? 'Attention' : 'Critical',
      description: 'Local session estimate using saved thresholds. Excludes cloud monthly budget.',
    }
    const summary: Summary = {
      start: this.start,
      end: r.timestamp,
      energy_kwh: this.energy,
      estimated_cost: this.energy * settings.tariff,
      tariff: settings.tariff,
      average_power: this.seconds ? this.weightedPower / this.seconds : r.power,
      peak_power: this.peak.power,
      peak_time: this.peak.timestamp,
      average_pf: this.pfTotal / this.count,
      min_voltage: this.minVoltage,
      max_voltage: this.maxVoltage,
      alert_count: this.alertSequence,
      reading_count: this.count,
      source: 'ble',
    }
    this.points = [...this.points, r].slice(-3600)
    this.previous = r
    this.latest = {
      ...r,
      type: 'reading',
      system_status: active ? 'attention' : 'normal',
      alerts: [...this.alerts],
      active_alert_count: active,
      health_score: health,
      today: summary,
      storage_status: 'local_session',
    }
    return this.latest
  }
  updateAlert(id: number, status: 'acknowledged' | 'resolved') {
    const alert = this.alerts.find((a) => a.id === id)
    if (!alert) return
    alert.status = status
    if (status === 'acknowledged') alert.acknowledged_at = new Date().toISOString()
    else alert.resolved_at = new Date().toISOString()
    if (this.latest)
      this.latest = {
        ...this.latest,
        alerts: [...this.alerts],
        active_alert_count: this.alerts.filter((a) => a.status !== 'resolved').length,
      }
  }
}

export function offlineDevice(connected: boolean, latest: DisplayReading | null): Device {
  return {
    status: connected ? 'ok' : 'degraded',
    database: 'unavailable',
    source: 'ble',
    source_status: connected ? 'live' : 'offline',
    last_reading: latest?.timestamp ?? null,
    uptime_seconds: 0,
    reading_count: latest?.today.reading_count ?? 0,
    active_alerts: latest?.active_alert_count ?? 0,
    websocket_clients: 0,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    database_engine: 'Cloud unavailable',
    storage_bytes: null,
    error: null,
  }
}
