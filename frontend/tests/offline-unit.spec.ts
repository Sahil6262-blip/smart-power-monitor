import { test, expect } from '@playwright/test'
import { BleDecoder, parseBleReading } from '../src/services/ble'
import { OfflineSession } from '../src/services/offlineSession'
const compact = { v: 231.8, i: 0.42, p: 93.2, e: 0.023, f: 50, pf: 0.96 }
const settings = {
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
const golden = () =>
  new DataView(
    Uint8Array.from([1, 0, 0, 0, 14, 9, 164, 1, 0, 164, 3, 0, 23, 0, 0, 0, 244, 1, 192, 3]).buffer,
  )
test('20-byte BLE packet matches firmware golden vector and rejects invalid/stale packets', () => {
  const decoder = new BleDecoder(),
    packet = golden()
  expect(decoder.push(packet, 1000)[0]).toMatchObject({
    voltage: 231.8,
    current: 0.42,
    power: 93.2,
    energy: 0.023,
    frequency: 50,
    power_factor: 0.96,
  })
  expect(decoder.push(packet)).toEqual([])
  expect(decoder.push(new DataView(new ArrayBuffer(19)))).toEqual([])
  packet.setUint32(0, 0, true)
  expect(decoder.push(packet)).toEqual([])
  packet.setUint32(0, 2, true)
  packet.setUint16(18, 1001, true)
  expect(decoder.push(packet)).toEqual([])
  packet.setUint16(18, 1000, true)
  packet.setUint8(6, 0xa0)
  packet.setUint8(7, 0x86)
  packet.setUint8(8, 1)
  expect(decoder.push(packet)[0].current).toBe(100)
  decoder.reset()
  packet.setUint32(0, 0xffffffff, true)
  expect(decoder.push(packet)).toHaveLength(1)
  packet.setUint32(0, 0, true)
  expect(decoder.push(packet)).toHaveLength(1)
  for (const value of [
    null,
    [],
    {},
    { ...compact, v: '231.8' },
    { ...compact, i: -1 },
    { ...compact, pf: 1.1 },
    { ...compact, p: Infinity },
  ])
    expect(parseBleReading(value)).toBeNull()
})
test('session calculations use counter deltas, reset/gap baselines, and local alert lifecycle', () => {
  const session = new OfflineSession()
  const ingest = (energy: number, now: number, power = 93.2) =>
    session.ingest(parseBleReading({ ...compact, e: energy, p: power }, now)!, settings)
  expect(ingest(5, 1000).today.energy_kwh).toBe(0)
  expect(ingest(5.01, 2000).today.energy_kwh).toBeCloseTo(0.01)
  expect(ingest(0.002, 3000).today.energy_kwh).toBeCloseTo(0.012)
  expect(ingest(1, 20000).today.energy_kwh).toBeCloseTo(0.012)
  session.disconnect()
  expect(ingest(2, 21000).today.energy_kwh).toBeCloseTo(0.012)
  expect(ingest(2.01, 22000, 2500).health_score.score).toBeLessThan(100)
  expect(session.alerts.some((a) => a.type === 'high_power' && a.status === 'active')).toBeTruthy()
  const high = session.alerts.find((a) => a.type === 'high_power')!
  session.updateAlert(high.id, 'acknowledged')
  ingest(2.02, 23000, 2500)
  expect(session.alerts.filter((a) => a.type === 'high_power')).toHaveLength(1)
  expect(high.status).toBe('acknowledged')
  ingest(2.03, 24000)
  expect(high.status).toBe('resolved')
  expect(session.latest?.budget).toBeUndefined()
  expect(session.latest?.today.estimated_cost).toBeCloseTo(0.042 * 8)
  session.reset()
  expect(session.points).toHaveLength(0)
  expect(ingest(9, 25000).today.energy_kwh).toBe(0)
})
