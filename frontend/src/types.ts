export interface Reading {
  id?: number
  timestamp: string
  source?: string
  voltage: number
  current: number
  power: number
  energy: number
  frequency: number
  power_factor: number
}
export interface Alert {
  id: number
  timestamp: string
  type: string
  severity: 'info' | 'warning' | 'critical'
  message: string
  measured_value: number
  threshold_value: number
  status: 'active' | 'acknowledged' | 'resolved'
  acknowledged_at: string | null
  resolved_at: string | null
}
export interface Summary {
  start: string
  end: string
  energy_kwh: number
  estimated_cost: number
  tariff: number
  average_power: number
  peak_power: number
  peak_time: string | null
  average_pf: number
  min_voltage: number
  max_voltage: number
  alert_count: number
  reading_count: number
  source: string
}
export interface Budget {
  target: number
  used: number
  remaining: number
  percentage: number
}
export interface HealthScore {
  score: number
  label: string
  description: string
  factors: { name: string; penalty: number }[]
}
export interface LiveMessage extends Reading {
  type: 'reading'
  system_status: string
  alerts: Alert[]
  active_alert_count: number
  health_score: HealthScore
  today: Summary
  budget: Budget
  storage_status: string
}
export interface Settings {
  tariff: number
  min_voltage: number
  max_voltage: number
  max_current: number
  max_power: number
  min_power_factor: number
  monthly_energy_target: number
  sudden_power_increase: number
  connection_timeout_seconds: number
}
export interface Consumption {
  summary: Summary
  buckets: { timestamp: string; energy_kwh: number; estimated_cost: number }[]
}
export interface Device {
  status: string
  database: string
  source: string
  source_status: string
  last_reading: string | null
  uptime_seconds: number
  reading_count: number
  active_alerts: number
  websocket_clients: number
  timezone: string
  database_engine: string
  storage_bytes: number | null
  error: string | null
}
