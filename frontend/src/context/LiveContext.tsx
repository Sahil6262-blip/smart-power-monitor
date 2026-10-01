import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, WS } from '../services/api'
import type { Device, LiveMessage, Reading, Settings } from '../types'
import { setDisplayZone } from '../utils/format'
import { BleConnection, supportsBluetooth, type BleState } from '../services/ble'
import { OfflineSession, offlineDevice, type DisplayReading } from '../services/offlineSession'
import { loadSettings, saveSettings } from '../services/offlineSettings'
import {
  loadOfflineReadings,
  mergeOfflineReadings,
  saveOfflineReading,
} from '../services/offlineStorage'

interface State {
  latest: DisplayReading | null
  points: Reading[]
  status: 'live' | 'waiting' | 'offline'
  age: number | null
  revision: number
  settings: Settings
  device: Device | null
  storageError: boolean
  offlineStorageError: boolean
  mode: 'cloud' | 'offline-device'
  cloudAvailable: boolean
  ble: BleState
  connectBle: (chooseAnother?: boolean) => Promise<void>
  disconnectBle: () => void
  settingsOrigin: 'cloud' | 'cached' | 'defaults'
  session: { points: Reading[]; alerts: LiveMessage['alerts'] }
  updateLocalAlert: (id: number, status: 'acknowledged' | 'resolved') => void
}
const Context = createContext<State | null>(null)

export function LiveProvider({ children }: { children: ReactNode }) {
  const [cloudLatest, setCloudLatest] = useState<LiveMessage | null>(null)
  const [cloudPoints, setCloudPoints] = useState<Reading[]>([])
  const [revision, setRevision] = useState(0)
  const [connected, setConnected] = useState(false)
  const [network, setNetwork] = useState(navigator.onLine)
  const [clock, setClock] = useState(Date.now())
  const [saved] = useState(loadSettings)
  const [settings, setSettings] = useState<Settings>(saved.values)
  const settingsRef = useRef(settings)
  const [settingsOrigin, setSettingsOrigin] = useState<State['settingsOrigin']>(
    saved.cached ? 'cached' : 'defaults',
  )
  const [device, setDevice] = useState<Device | null>(null)
  const [storageError, setStorageError] = useState(false)
  const started = useRef(Date.now())
  const cloudSource = useRef<string | null>(null)
  const [ble, setBle] = useState<BleState>({
    status: supportsBluetooth() ? 'idle' : 'unsupported',
    name: 'SmartPowerMonitor',
    error: '',
  })
  const bleConnection = useRef<BleConnection | null>(null)
  const [session] = useState(() => new OfflineSession())
  const [bleLatest, setBleLatest] = useState<DisplayReading | null>(null)
  const [, setSessionVersion] = useState(0)
  const cloudAvailableRef = useRef(false)
  const autoReconnectBle = useRef(true)
  const [offlinePoints, setOfflinePoints] = useState<Reading[]>([])
  const [offlineStorageError, setOfflineStorageError] = useState(false)
  const [deviceId, setDeviceId] = useState(() => {
    try {
      return localStorage.getItem('wattwise-ble-device') || ''
    } catch {
      return ''
    }
  })
  const deviceIdRef = useRef(deviceId)

  useEffect(() => {
    let alive = true
    void loadOfflineReadings(deviceId).then((rows) => {
      if (!alive || deviceIdRef.current !== deviceId) return
      if (rows === null) setOfflineStorageError(true)
      else setOfflinePoints((current) => mergeOfflineReadings(rows, current))
    })
    return () => {
      alive = false
    }
  }, [deviceId])

  useEffect(() => {
    let alive = true
    const connection = new BleConnection(
      (state) => {
        if (!alive) return
        setBle(state)
        if (state.status !== 'connected') session.disconnect()
      },
      (reading, readingDeviceId) => {
        if (!alive) return
        setBleLatest(session.ingest(reading, settingsRef.current))
        setOfflinePoints((current) => mergeOfflineReadings(current, [reading]))
        void saveOfflineReading(reading, readingDeviceId).then((saved) => {
          if (alive && deviceIdRef.current === readingDeviceId) setOfflineStorageError(!saved)
        })
        setSessionVersion((v) => v + 1)
      },
      (selectedDeviceId) => {
        if (!alive || deviceIdRef.current === selectedDeviceId) return
        deviceIdRef.current = selectedDeviceId
        setDeviceId(selectedDeviceId)
        session.reset()
        setOfflinePoints([])
        setBleLatest(null)
        setSessionVersion((v) => v + 1)
      },
    )
    bleConnection.current = connection
    const reconnect = () => {
      if (alive && autoReconnectBle.current && !cloudAvailableRef.current)
        void connection.reconnectAuthorized()
    }
    void connection.restore().then(reconnect)
    const reconnectTimer = setInterval(reconnect, 5000)
    return () => {
      alive = false
      clearInterval(reconnectTimer)
      connection.dispose()
      bleConnection.current = null
    }
  }, [session])

  const connectBle = useCallback(
    async (chooseAnother = false) => {
      autoReconnectBle.current = true
      await bleConnection.current?.connect(chooseAnother)
    },
    [session],
  )
  const disconnectBle = useCallback(() => {
    autoReconnectBle.current = false
    bleConnection.current?.disconnect()
  }, [])
  const updateLocalAlert = useCallback(
    (id: number, status: 'acknowledged' | 'resolved') => {
      session.updateAlert(id, status)
      setBleLatest(session.latest)
      setSessionVersion((v) => v + 1)
    },
    [session],
  )

  useEffect(() => {
    if (!network) return
    const controller = new AbortController()
    void api<Settings>('/settings', { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return
        settingsRef.current = value
        setSettings(value)
        saveSettings(value)
        setSettingsOrigin('cloud')
      })
      .catch(() => {})
    void api<Device>('/health', { signal: controller.signal })
      .then((d) => {
        if (controller.signal.aborted) return
        if (cloudSource.current && cloudSource.current !== d.source) {
          setCloudLatest(null)
          setCloudPoints([])
          started.current = Date.now()
        }
        cloudSource.current = d.source
        setDevice(d)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [revision, network])

  useEffect(() => {
    let alive = true,
      socket: WebSocket | undefined,
      retry: ReturnType<typeof setTimeout> | undefined
    let attempts = 0,
      socketGeneration = 0,
      openedAt = 0
    const historyController = new AbortController()
    const append = (items: Reading[]) =>
      setCloudPoints((old) => {
        const map = new Map([...old, ...items].map((p) => [p.timestamp, p]))
        return [...map.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-300)
      })
    void api<Reading[]>('/history/trend?range=1m&points=300', { signal: historyController.signal })
      .then((rows) => {
        if (alive) append(rows)
      })
      .catch(() => {})

    const schedule = () => {
      clearTimeout(retry)
      if (alive)
        retry = setTimeout(connect, Math.min(1000 * 2 ** attempts++, 10000) + Math.random() * 300)
    }
    const connect = () => {
      if (!alive) return
      clearTimeout(retry)
      if (!navigator.onLine) {
        schedule()
        return
      }
      const generation = ++socketGeneration
      socket?.close()
      openedAt = Date.now()
      const current = new WebSocket(WS)
      socket = current
      current.onopen = () => {
        if (!alive || generation !== socketGeneration) return
        setConnected(true)
        attempts = 0
        setRevision((v) => v + 1)
      }
      current.onmessage = (event) => {
        if (!alive || generation !== socketGeneration) return
        try {
          const msg = JSON.parse(event.data)
          if (
            msg.type === 'reading' &&
            Number.isFinite(msg.power) &&
            Number.isFinite(Date.parse(msg.timestamp)) &&
            msg.today &&
            msg.budget &&
            msg.health_score &&
            Array.isArray(msg.alerts)
          ) {
            if (cloudSource.current && cloudSource.current !== msg.source) setCloudPoints([])
            cloudSource.current = msg.source
            setCloudLatest(msg)
            append([msg])
            setStorageError(false)
            if (msg.alerts.length) setRevision((v) => v + 1)
          } else if (msg.type === 'settings_changed' || msg.type === 'alerts_changed')
            setRevision((v) => v + 1)
          else if (msg.type === 'status') setStorageError(msg.storage_status !== 'connected')
        } catch {
          /* Malformed packets must not change the selected source. */
        }
      }
      current.onerror = () => current.close()
      current.onclose = () => {
        if (!alive || generation !== socketGeneration) return
        setConnected(false)
        schedule()
      }
    }
    const online = () => {
      setNetwork(true)
      attempts = 0
      setRevision((v) => v + 1)
      connect()
    }
    const offline = () => {
      setNetwork(false)
      setConnected(false)
      socketGeneration++
      socket?.close()
      schedule()
    }
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    connect()
    const ticker = setInterval(() => {
      setClock(Date.now())
      // Browsers may leave an unsuccessful handshake pending for a long time.
      if (socket?.readyState === WebSocket.CONNECTING && Date.now() - openedAt > 12000)
        socket.close()
    }, 250)
    return () => {
      alive = false
      socketGeneration++
      historyController.abort()
      clearTimeout(retry)
      clearInterval(ticker)
      socket?.close()
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [])

  const cloudAge = cloudLatest
    ? Math.max(0, (clock - Date.parse(cloudLatest.timestamp)) / 1000)
    : null
  const cloudAvailable = network && connected && !storageError && cloudAge !== null && cloudAge < 10
  cloudAvailableRef.current = cloudAvailable
  const mode: State['mode'] =
    !cloudAvailable &&
    (offlinePoints.length > 0 ||
      bleLatest !== null ||
      ['connected', 'disconnected'].includes(ble.status))
      ? 'offline-device'
      : 'cloud'
  const latest = mode === 'cloud' ? cloudLatest : bleLatest
  const age = latest ? Math.max(0, (clock - Date.parse(latest.timestamp)) / 1000) : null
  const sourceConnected =
    mode === 'cloud' ? network && connected && !storageError : ble.status === 'connected'
  const status =
    !sourceConnected && (latest || !network || ble.status === 'disconnected')
      ? 'offline'
      : (age ?? (clock - started.current) / 1000) >= 10
        ? 'offline'
        : sourceConnected && age !== null && age < 3
          ? 'live'
          : 'waiting'
  const visibleDevice =
    mode === 'cloud' ? device : offlineDevice(ble.status === 'connected', bleLatest)
  useEffect(() => {
    setDisplayZone(
      mode === 'cloud'
        ? device?.timezone || 'Asia/Kolkata'
        : Intl.DateTimeFormat().resolvedOptions().timeZone,
    )
  }, [mode, device?.timezone])

  return (
    <Context.Provider
      value={{
        latest,
        points: mode === 'cloud' ? cloudPoints : offlinePoints.slice(-300),
        status,
        age,
        revision,
        settings,
        device: visibleDevice,
        storageError: mode === 'cloud' && storageError,
        offlineStorageError,
        mode,
        cloudAvailable,
        ble,
        connectBle,
        disconnectBle,
        settingsOrigin:
          mode === 'offline-device' && settingsOrigin === 'cloud' ? 'cached' : settingsOrigin,
        session: { points: offlinePoints, alerts: [...session.alerts] },
        updateLocalAlert,
      }}
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
