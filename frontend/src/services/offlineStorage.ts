import type { Reading } from '../types'

export const OFFLINE_DB = 'wattwise-offline'
export const OFFLINE_STORE = 'readings'
export const OFFLINE_LIMIT = 10_000
export interface StoredReading extends Reading {
  key: string
  deviceId: string
  source: 'ble'
  synced: false
}

let opening: Promise<IDBDatabase> | undefined

function database(): Promise<IDBDatabase> {
  if (opening) return opening
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB, 1)
    let finished = false
    const fail = () => {
      finished = true
      clearTimeout(timer)
      reject(new Error('Offline reading storage is unavailable'))
    }
    const timer = setTimeout(fail, 5000)
    request.onblocked = fail
    request.onerror = fail
    request.onupgradeneeded = () => {
      if (finished) {
        request.transaction?.abort()
        return
      }
      const store = request.result.createObjectStore(OFFLINE_STORE, { keyPath: 'key' })
      store.createIndex('timestamp', 'timestamp')
      store.createIndex('device_timestamp', ['deviceId', 'timestamp'])
    }
    request.onsuccess = () => {
      clearTimeout(timer)
      const db = request.result
      if (finished) {
        db.close()
        return
      }
      db.onversionchange = () => {
        db.close()
        opening = undefined
      }
      db.onclose = () => {
        opening = undefined
      }
      resolve(db)
    }
  })
  opening = pending
  void pending.catch(() => {
    if (opening === pending) opening = undefined
  })
  return pending
}

// Exact repeated records collapse; equal measurements at different times remain distinct.
function readingKey(r: Reading): string {
  return JSON.stringify([
    r.timestamp,
    r.voltage,
    r.current,
    r.power,
    r.energy,
    r.frequency,
    r.power_factor,
  ])
}

export function mergeOfflineReadings(...groups: Reading[][]): Reading[] {
  const unique = new Map<string, Reading>()
  for (const rows of groups) for (const row of rows) unique.set(readingKey(row), row)
  return [...unique.values()]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-OFFLINE_LIMIT)
    .map((row, index) => ({ ...row, id: index + 1 }))
}

// Called after normalization, without awaiting it in the live rendering path.
export async function saveOfflineReading(reading: Reading, deviceId: string): Promise<boolean> {
  if (reading.source !== 'ble') return false
  try {
    const db = await database()
    const record: StoredReading = {
      key: JSON.stringify([deviceId, readingKey(reading)]),
      deviceId,
      timestamp: reading.timestamp,
      voltage: reading.voltage,
      current: reading.current,
      power: reading.power,
      energy: reading.energy,
      frequency: reading.frequency,
      power_factor: reading.power_factor,
      source: 'ble',
      synced: false,
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
      const store = tx.objectStore(OFFLINE_STORE)
      store.put(record)
      // In the same transaction as the write: bounded even across simultaneous tabs.
      const count = store.count()
      count.onsuccess = () => {
        let excess = count.result - OFFLINE_LIMIT
        if (excess <= 0) return
        const oldest = store.index('timestamp').openCursor()
        oldest.onsuccess = () => {
          const cursor = oldest.result
          if (!cursor || excess <= 0) return
          cursor.delete()
          if (--excess > 0) cursor.continue()
        }
      }
    })
    return true
  } catch {
    return false
  }
}

// null signals failure, [] signals an empty device history. No cloud writes or deletes on reconnect.
export async function loadOfflineReadings(deviceId: string): Promise<StoredReading[] | null> {
  try {
    const db = await database()
    return await new Promise<StoredReading[]>((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE, 'readonly')
      const range = IDBKeyRange.bound([deviceId, ''], [deviceId, '\uffff'])
      const request = tx.objectStore(OFFLINE_STORE).index('device_timestamp').getAll(range)
      tx.oncomplete = () => resolve(request.result as StoredReading[])
      tx.onabort = () => reject(tx.error)
    })
  } catch {
    return null
  }
}
