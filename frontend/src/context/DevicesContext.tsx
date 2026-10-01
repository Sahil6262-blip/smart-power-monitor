import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { DeviceDraft, InventoryDevice } from '../types/device'
import { validateDevice } from '../types/device'
import { loadDevices, persistDevice } from '../services/deviceStorage'

interface Inventory {
  devices: InventoryDevice[]
  loading: boolean
  storageWarning: boolean
  save: (draft: DeviceDraft, id?: string) => void
  remove: (id: string) => void
  setActive: (id: string, quantity: number) => void
}
const Context = createContext<Inventory | null>(null)

export function DevicesProvider({ children }: { children: ReactNode }) {
  const [devices, setDevices] = useState<InventoryDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [storageWarning, setStorageWarning] = useState(false)
  const current = useRef(devices)
  const ready = useRef(false)
  const pending = useRef(new Map<string, InventoryDevice | string>())
  const queue = useRef(Promise.resolve())
  useEffect(() => {
    let alive = true
    void loadDevices()
      .then((rows) => {
        if (alive) {
          current.current = rows
          setDevices(rows)
        }
      })
      .catch(() => {
        if (alive) setStorageWarning(true)
      })
      .finally(() => {
        if (alive) {
          ready.current = true
          setLoading(false)
        }
      })
    return () => {
      alive = false
    }
  }, [])

  const commit = (next: InventoryDevice[], change: InventoryDevice | string) => {
    current.current = next
    setDevices(next)
    const id = typeof change === 'string' ? change : change.id
    pending.current.set(id, change)
    // Retry any earlier unsaved mutations too, without blocking the immediate UI update.
    queue.current = queue.current.then(async () => {
      for (const [key, mutation] of pending.current) {
        try {
          await persistDevice(mutation)
          if (pending.current.get(key) === mutation) pending.current.delete(key)
        } catch {
          setStorageWarning(true)
          return
        }
      }
      setStorageWarning(false)
    })
  }
  const save = (draft: DeviceDraft, id?: string) => {
    if (!ready.current) throw new Error('Device inventory is still loading.')
    const errors = validateDevice(draft)
    if (Object.keys(errors).length) throw new Error(Object.values(errors)[0])
    const old = id ? current.current.find((d) => d.id === id) : undefined
    if (id && !old) throw new Error('This device no longer exists.')
    const now = new Date().toISOString()
    const device: InventoryDevice = {
      ...draft,
      name: draft.name.trim(),
      room: draft.room.trim(),
      id: old?.id || crypto.randomUUID(),
      createdAt: old?.createdAt || now,
      updatedAt: now,
    }
    commit(
      old ? current.current.map((d) => (d.id === id ? device : d)) : [...current.current, device],
      device,
    )
  }
  const remove = (id: string) => {
    if (!ready.current) return
    commit(
      current.current.filter((d) => d.id !== id),
      id,
    )
  }
  const setActive = (id: string, quantity: number) => {
    const device = current.current.find((d) => d.id === id)
    if (device) save({ ...device, activeQuantity: quantity }, id)
  }
  return (
    <Context.Provider value={{ devices, loading, storageWarning, save, remove, setActive }}>
      {children}
    </Context.Provider>
  )
}
export function useDevices() {
  const value = useContext(Context)
  if (!value) throw new Error('DevicesProvider is required')
  return value
}
