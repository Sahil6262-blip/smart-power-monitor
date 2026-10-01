import type { Page } from '@playwright/test'

export async function mockBluetooth(page: Page) {
  await page.addInitScript(() => {
    let sequence = 0
    let subscribed = false,
      connects = 0,
      starts = 0
    class Characteristic extends EventTarget {
      value?: DataView
      async startNotifications() {
        subscribed = true
        starts++
        return this
      }
      async stopNotifications() {
        subscribed = false
        return this
      }
    }
    const characteristic = new Characteristic()
    const device = new EventTarget() as EventTarget & { id: string; name: string; gatt: object }
    device.id = 'test-power-meter'
    device.name = 'SmartPowerMonitor'
    const gatt = {
      connected: false,
      async connect() {
        this.connected = true
        connects++
        return this
      },
      async getPrimaryService() {
        return { getCharacteristic: async () => characteristic }
      },
      disconnect() {
        if (!this.connected) return
        this.connected = false
        subscribed = false
        device.dispatchEvent(new Event('gattserverdisconnected'))
      },
    }
    device.gatt = gatt
    let cancel = false,
      pickerCount = 0
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: {
        async getDevices() {
          return [device]
        },
        async requestDevice() {
          pickerCount++
          if (cancel) throw new DOMException('User cancelled', 'NotFoundError')
          return device
        },
      },
    })
    Object.assign(window, {
      bleTest: {
        send(raw: string) {
          if (!subscribed || !gatt.connected) return
          const r = JSON.parse(raw)
          const bytes = new ArrayBuffer(20),
            packet = new DataView(bytes)
          packet.setUint32(0, ++sequence, true)
          packet.setUint16(4, Math.round(r.v * 10), true)
          const u24 = (o: number, v: number) => {
            for (let i = 0; i < 3; i++) packet.setUint8(o + i, Math.round(v) >>> (8 * i))
          }
          u24(6, r.i * 1000)
          u24(9, r.p * 10)
          packet.setUint32(12, Math.round(r.e * 1000), true)
          packet.setUint16(16, Math.round(r.f * 10), true)
          packet.setUint16(18, Math.round(r.pf * 1000), true)
          characteristic.value = packet
          characteristic.dispatchEvent(new Event('characteristicvaluechanged'))
        },
        disconnect: () => gatt.disconnect(),
        cancel: () => {
          cancel = true
        },
        stats: () => ({ connects, starts }),
        pickerCount: () => pickerCount,
      },
    })
  })
}
export async function notify(page: Page, power = 93.2, energy = 0.023) {
  await page.evaluate(
    ({ power, energy }) => {
      ;(window as any).bleTest.send(
        JSON.stringify({ v: 231.8, i: 0.42, p: power, e: energy, f: 50, pf: 0.96 }) + '\n',
      )
    },
    { power, energy },
  )
}
