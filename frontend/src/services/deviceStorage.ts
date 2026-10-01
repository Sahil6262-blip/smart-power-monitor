import type { InventoryDevice } from '../types/device'
import { validateDevice } from '../types/device'

// Separate inventory database: the existing BLE reading database/schema is untouched.
export const DEVICE_DB = 'wattwise-devices'
export const DEVICE_STORE = 'devices'
let opening: Promise<IDBDatabase> | undefined

function database(): Promise<IDBDatabase> {
  if (opening) return opening
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DEVICE_DB, 1)
    let finished = false
    const fail = () => {
      finished = true
      clearTimeout(timeout)
      reject(new Error('Device storage unavailable'))
    }
    const timeout = setTimeout(fail, 5000)
    request.onerror = fail
    request.onblocked = fail
    request.onupgradeneeded = () => {
      if (finished) {
        request.transaction?.abort()
        return
      }
      request.result.createObjectStore(DEVICE_STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => {
      clearTimeout(timeout)
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

export async function loadDevices(): Promise<InventoryDevice[]> {
  const db = await database()
  const rows = await new Promise<InventoryDevice[]>((resolve, reject) => {
    const tx = db.transaction(DEVICE_STORE, 'readonly')
    const request = tx.objectStore(DEVICE_STORE).getAll()
    tx.oncomplete = () => resolve(request.result)
    tx.onabort = () => reject(tx.error)
  })
  // Corrupt local data must not crash the rest of the dashboard.
  for (const row of rows) {
    if (
      !row ||
      typeof row.id !== 'string' ||
      typeof row.name !== 'string' ||
      typeof row.room !== 'string' ||
      typeof row.createdAt !== 'string' ||
      typeof row.updatedAt !== 'string' ||
      Object.keys(validateDevice(row)).length
    )
      throw new Error('Saved device data could not be read')
  }
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}

// Each mutation touches only its own inventory record. IndexedDB serializes read/write transactions.
export async function persistDevice(change: InventoryDevice | string): Promise<void> {
  const db = await database()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DEVICE_STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
    const store = tx.objectStore(DEVICE_STORE)
    if (typeof change === 'string') store.delete(change)
    else store.put(change)
  })
}
