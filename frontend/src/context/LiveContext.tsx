import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, WS } from '../services/api'
import type { Device, LiveMessage, Reading, Settings } from '../types'
import { setDisplayZone } from '../utils/format'

interface State {
  latest: LiveMessage | null
  points: Reading[]
  status: 'live' | 'waiting' | 'offline'
  age: number | null
  revision: number
  settings: Settings | null
  device: Device | null
  storageError: boolean
}
const Context = createContext<State | null>(null)

export function LiveProvider({ children }: { children: ReactNode }) {
  const [latest, setLatest] = useState<LiveMessage | null>(null)
  const [points, setPoints] = useState<Reading[]>([])
  const [revision, setRevision] = useState(0)
  const [connected, setConnected] = useState(false)
  const [clock, setClock] = useState(Date.now())
  const [settings, setSettings] = useState<Settings | null>(null)
  const [device, setDevice] = useState<Device | null>(null)
  const [storageError, setStorageError] = useState(false)
  const last = useRef<number | null>(null)
  const started = useRef(Date.now())
  const source = useRef<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void api<Settings>('/settings', { signal: controller.signal })
      .then(setSettings)
      .catch(() => {})
    void api<Device>('/health', { signal: controller.signal })
      .then((d) => {
        // A backend mode switch must not leave demo values in a hardware workspace.
        if (source.current && source.current !== d.source) {
          setLatest(null)
          setPoints([])
          last.current = null
          started.current = Date.now()
        }
        source.current = d.source
        setDevice(d)
        setDisplayZone(d.timezone)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [revision])
  useEffect(() => {
    let alive = true,
      socket: WebSocket,
      retry: ReturnType<typeof setTimeout>,
      attempts = 0
    const append = (items: Reading[]) =>
      setPoints((old) => {
        const map = new Map([...items, ...old].map((p) => [p.timestamp, p]))
        return [...map.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-300)
      })
    void api<Reading[]>('/history/trend?range=1m&points=300')
      .then((rows) => {
        if (alive) append(rows)
      })
      .catch(() => {})
    const connect = () => {
      if (!alive) return
      socket = new WebSocket(WS)
      socket.onopen = () => {
        setConnected(true)
        attempts = 0
        setRevision((r) => r + 1)
      }
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (
            msg.type === 'reading' &&
            Number.isFinite(msg.power) &&
            Number.isFinite(Date.parse(msg.timestamp))
          ) {
            if (source.current && source.current !== msg.source) setPoints([])
            source.current = msg.source
            last.current = Date.parse(msg.timestamp)
            setLatest(msg)
            append([msg])
            setStorageError(false)
            if (msg.alerts.length) setRevision((r) => r + 1)
          } else if (msg.type === 'settings_changed' || msg.type === 'alerts_changed')
            setRevision((r) => r + 1)
          else if (msg.type === 'status') setStorageError(msg.storage_status !== 'connected')
        } catch {
          /* Ignore malformed messages; stale-data detection remains active. */
        }
      }
      socket.onerror = () => socket.close()
      socket.onclose = () => {
        if (!alive) return
        setConnected(false)
        retry = setTimeout(connect, Math.min(1000 * 2 ** attempts++, 10000) + Math.random() * 300)
      }
    }
    connect()
    const ticker = setInterval(() => setClock(Date.now()), 250)
    return () => {
      alive = false
      clearTimeout(retry)
      clearInterval(ticker)
      socket?.close()
    }
  }, [])
  const age = last.current === null ? null : Math.max(0, (clock - last.current) / 1000)
  const staleAge = age ?? (clock - started.current) / 1000
  const status =
    staleAge >= 10
      ? 'offline'
      : connected && age !== null && age < 3 && !storageError
        ? 'live'
        : 'waiting'
  return (
    <Context.Provider
      value={{ latest, points, status, age, revision, settings, device, storageError }}
    >
      {children}
    </Context.Provider>
  )
}

export function useLive() {
  const context = useContext(Context)
  if (!context) throw new Error('LiveProvider is required')
  return context
}
