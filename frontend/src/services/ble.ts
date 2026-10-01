import type { Reading } from '../types'

export const BLE_NAME = 'SmartPowerMonitor'
export const BLE_SERVICE = 'b8541000-b5e6-4af4-9a44-6a0f78d40100'
export const BLE_CHARACTERISTIC = 'b8541001-b5e6-4af4-9a44-6a0f78d40100'
export type BleStatus = 'unsupported' | 'idle' | 'connecting' | 'connected' | 'disconnected'
export interface BleState {
  status: BleStatus
  name: string
  error: string
}
export const supportsBluetooth = () => window.isSecureContext && !!navigator.bluetooth

const fields = [
  ['v', 'voltage', 1000],
  ['i', 'current', 1000],
  ['p', 'power', 1_000_000],
  ['e', 'energy', Number.MAX_SAFE_INTEGER],
  ['f', 'frequency', 100],
  ['pf', 'power_factor', 1],
] as const

export function parseBleReading(value: unknown, now = Date.now()): Reading | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const reading: Reading = {
    timestamp: new Date(now).toISOString(),
    source: 'ble',
    voltage: 0,
    current: 0,
    power: 0,
    energy: 0,
    frequency: 0,
    power_factor: 0,
  }
  for (const [key, field, max] of fields) {
    const number = record[key]
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > max)
      return null
    reading[field] = number
  }
  return reading
}

// Protocol v1: one 20-byte little-endian notification. See docs/OFFLINE_MODE.md.
// uint24 current keeps the full 100 A range at 0.001 A resolution.
export class BleDecoder {
  private sequence: number | null = null
  reset() {
    this.sequence = null
  }
  push(bytes: DataView, now = Date.now()): Reading[] {
    if (bytes.byteLength !== 20) return []
    const sequence = bytes.getUint32(0, true)
    if (this.sequence !== null) {
      const forward = (sequence - this.sequence) >>> 0
      if (forward === 0 || forward >= 0x80000000) return []
    }
    const u24 = (offset: number) =>
      bytes.getUint8(offset) + bytes.getUint8(offset + 1) * 256 + bytes.getUint8(offset + 2) * 65536
    const reading = parseBleReading(
      {
        v: bytes.getUint16(4, true) / 10,
        i: u24(6) / 1000,
        p: u24(9) / 10,
        e: bytes.getUint32(12, true) / 1000,
        f: bytes.getUint16(16, true) / 10,
        pf: bytes.getUint16(18, true) / 1000,
      },
      now,
    )
    if (!reading) return []
    this.sequence = sequence
    return [reading]
  }
}

export class BleConnection {
  private device?: BluetoothDevice
  private characteristic?: BluetoothRemoteGATTCharacteristic
  private decoder = new BleDecoder()
  private generation = 0
  private busy = false
  private disposed = false
  private savedIdKey = 'wattwise-ble-device'
  constructor(
    private onState: (state: BleState) => void,
    private onReading: (reading: Reading) => void,
    private onDeviceChanged: () => void = () => {},
  ) {}
  async restore() {
    if (!supportsBluetooth() || !navigator.bluetooth.getDevices) return
    try {
      const id = localStorage.getItem(this.savedIdKey)
      const devices = await navigator.bluetooth.getDevices()
      if (!this.disposed && !this.busy && !this.device)
        this.device = devices.find((device) => device.id === id)
    } catch {
      /* Permissions/storage may be unavailable; chooser still works. */
    }
  }
  private emit(status: BleStatus, error = '') {
    if (!this.disposed) this.onState({ status, name: this.device?.name || BLE_NAME, error })
  }
  private onValue = (event: Event) => {
    if (this.disposed || !this.device?.gatt?.connected) return
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value
    if (value) for (const reading of this.decoder.push(value)) this.onReading(reading)
  }
  private onDisconnect = () => {
    this.generation++
    this.busy = false
    this.characteristic?.removeEventListener('characteristicvaluechanged', this.onValue)
    this.characteristic = undefined
    this.decoder.reset()
    this.emit('disconnected')
  }
  async reconnectAuthorized() {
    if (this.device && !this.device.gatt?.connected) await this.connect(false, false)
  }
  async connect(chooseAnother = false, allowPicker = true) {
    if (this.disposed || this.busy) return
    if (!allowPicker && !this.device) return
    if (!supportsBluetooth()) {
      this.emit('unsupported', 'Web Bluetooth is unavailable in this browser.')
      return
    }
    this.busy = true
    const generation = ++this.generation
    let timeout: ReturnType<typeof setTimeout> | undefined
    this.emit('connecting')
    try {
      // requestDevice is reached synchronously from the button click.
      const device =
        !chooseAnother && this.device
          ? this.device
          : await navigator.bluetooth.requestDevice({
              filters: [{ name: BLE_NAME }],
              optionalServices: [BLE_SERVICE],
            })
      if (this.disposed || generation !== this.generation) return
      if (this.device && this.device.id !== device.id) this.onDeviceChanged()
      this.characteristic?.removeEventListener('characteristicvaluechanged', this.onValue)
      this.device?.removeEventListener('gattserverdisconnected', this.onDisconnect)
      this.device?.gatt?.disconnect()
      this.device = device
      try {
        localStorage.setItem(this.savedIdKey, device.id)
      } catch {
        /* Optional persistence. */
      }
      device.addEventListener('gattserverdisconnected', this.onDisconnect)
      this.decoder.reset()
      timeout = setTimeout(() => {
        if (generation !== this.generation || this.disposed) return
        this.disconnect()
        this.emit('disconnected', 'Bluetooth connection timed out. Move closer and reconnect.')
      }, 12000)
      const server = await device.gatt?.connect()
      if (this.disposed || generation !== this.generation) {
        device.gatt?.disconnect()
        return
      }
      if (!server) throw new Error('This device has no Bluetooth GATT server.')
      const service = await server.getPrimaryService(BLE_SERVICE)
      const characteristic = await service.getCharacteristic(BLE_CHARACTERISTIC)
      if (this.disposed || generation !== this.generation) {
        device.gatt?.disconnect()
        return
      }
      this.characteristic = characteristic
      characteristic.addEventListener('characteristicvaluechanged', this.onValue)
      await characteristic.startNotifications()
      if (this.disposed || generation !== this.generation) return
      this.emit('connected')
    } catch (error) {
      if (this.disposed || generation !== this.generation) return
      this.characteristic?.removeEventListener('characteristicvaluechanged', this.onValue)
      this.device?.removeEventListener('gattserverdisconnected', this.onDisconnect)
      this.device?.gatt?.disconnect()
      this.characteristic = undefined
      this.decoder.reset()
      const cancelled = error instanceof DOMException && error.name === 'NotFoundError'
      this.emit(
        this.device ? 'disconnected' : 'idle',
        cancelled
          ? 'Device selection cancelled.'
          : error instanceof Error
            ? error.message
            : 'Unable to connect to Bluetooth.',
      )
    } finally {
      clearTimeout(timeout)
      if (generation === this.generation) this.busy = false
    }
  }
  disconnect() {
    this.generation++
    this.busy = false
    this.characteristic?.removeEventListener('characteristicvaluechanged', this.onValue)
    this.characteristic = undefined
    this.device?.removeEventListener('gattserverdisconnected', this.onDisconnect)
    this.device?.gatt?.disconnect()
    this.decoder.reset()
    this.emit('disconnected')
  }
  dispose() {
    this.disposed = true
    this.disconnect()
  }
}
