import type { Settings } from '../types'
import { API } from './api'
export const defaultSettings: Settings = {
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
const settingsKey = 'wattwise-offline-settings:' + (API || location.origin)
export function loadSettings(): { values: Settings; cached: boolean } {
  try {
    const value = JSON.parse(localStorage.getItem(settingsKey) || 'null')
    if (
      value &&
      Object.keys(defaultSettings).every(
        (k) => typeof value[k] === 'number' && Number.isFinite(value[k]) && value[k] >= 0,
      ) &&
      value.min_voltage < value.max_voltage &&
      value.monthly_energy_target > 0 &&
      value.min_power_factor <= 1
    ) {
      return { values: value, cached: true }
    }
  } catch {
    /* Defaults are explicitly identified in the UI. */
  }
  return { values: { ...defaultSettings }, cached: false }
}
export function saveSettings(values: Settings) {
  try {
    localStorage.setItem(settingsKey, JSON.stringify(values))
  } catch {
    /* Private browsing/quota. */
  }
}
