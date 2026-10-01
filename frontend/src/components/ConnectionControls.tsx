import { Bluetooth, BluetoothConnected, LoaderCircle, Wifi } from 'lucide-react'
import { useLive } from '../context/LiveContext'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useEffect } from 'react'

export function ConnectionControls() {
  const { mode, status, cloudAvailable, ble, connectBle, disconnectBle, settingsOrigin } = useLive()
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  useEffect(() => {
    let alive = true
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      void navigator.serviceWorker.ready.then(() => {
        if (alive) setOfflineReady(true)
      })
    }
    return () => {
      alive = false
    }
  }, [setOfflineReady])
  const local = mode === 'offline-device'
  const detail = local
    ? ble.status === 'disconnected'
      ? 'Device disconnected'
      : status === 'live'
        ? 'Live via Bluetooth • Cloud unavailable'
        : 'Waiting for device readings • Cloud unavailable'
    : cloudAvailable
      ? status === 'live'
        ? 'Live • Synced'
        : 'Waiting for fresh cloud readings'
      : 'Connect ESP32 for live monitoring'
  return (
    <section className="connection-panel" aria-label="Data connection">
      <div className="connection-line">
        <div className={'mode-indicator ' + (local ? 'bluetooth-mode' : '')}>
          {local ? <BluetoothConnected size={19} /> : <Wifi size={19} />}
          <div>
            <strong>
              <span className={'status-dot ' + (status === 'live' ? 'pulse' : '')} />
              {local ? 'OFFLINE DEVICE MODE' : cloudAvailable ? 'CLOUD MODE' : 'OFFLINE'}
            </strong>
            <p role="status">{detail}</p>
          </div>
        </div>
        <div className="connection-actions">
          <span className="pwa-ready">
            {offlineReady ? 'App ready offline' : 'Open online once to cache the app'}
          </span>
          {ble.status === 'connected' ? (
            <>
              <span className="bluetooth-ready">Bluetooth {local ? 'connected' : 'standby'}</span>
              <button className="button small" onClick={disconnectBle}>
                Disconnect Bluetooth
              </button>
            </>
          ) : (
            <button
              className="button small"
              disabled={ble.status === 'connecting' || ble.status === 'unsupported'}
              onClick={() => void connectBle()}
            >
              {ble.status === 'connecting' ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Bluetooth size={15} />
              )}
              {ble.status === 'connecting'
                ? 'Connecting…'
                : ble.status === 'disconnected'
                  ? 'Reconnect device'
                  : 'Connect Offline Device'}
            </button>
          )}
          {ble.status === 'connecting' && (
            <button className="text-link" onClick={disconnectBle}>
              Cancel
            </button>
          )}
          {ble.status === 'disconnected' && (
            <button className="text-link" onClick={() => void connectBle(true)}>
              Choose another device
            </button>
          )}
        </div>
      </div>
      {local && (
        <p className="offline-explanation">
          Bluetooth session only • Readings and alerts stay in this tab and are not uploaded.
          Session cost and health use {settingsOrigin === 'defaults' ? 'default' : 'last saved'}{' '}
          thresholds and tariff. Monthly totals and cloud reports return when cloud reconnects.
        </p>
      )}
      {ble.status === 'unsupported' && (
        <p className="offline-explanation">
          This browser does not support Web Bluetooth. Use a supported Chrome or Edge browser on
          Android or desktop. Installing the PWA does not add Bluetooth support to Safari/iOS.
        </p>
      )}
      {ble.error && (
        <p className="bluetooth-error" role="alert">
          {ble.error}
        </p>
      )}
      {needRefresh && (
        <div className="pwa-update">
          An app update is ready. Reloading ends the current Bluetooth session.
          <button className="button small" onClick={() => void updateServiceWorker(true)}>
            Update and reload
          </button>
        </div>
      )}
    </section>
  )
}
