import { Cable, Clock3, Cpu, Database, Radio, Server, Wifi } from 'lucide-react'
import { useLive } from '../context/LiveContext'
import { useResource } from '../hooks/useResource'
import type { Device } from '../types'
import { Badge, ErrorState, Loading, PageHeading, Panel } from '../components/UI'
import { number, time } from '../utils/format'
import { ConnectionBadge } from '../components/Shell'

export default function DeviceStatus() {
  const { status, latest, age, mode } = useLive()
  const local = mode === 'offline-device'
  const result = useResource<Device>('/health', 0, 10000)
  const d = result.data
  const cards = [
    {
      icon: Radio,
      label: 'Data source',
      value: local
        ? 'Bluetooth ESP32'
        : d?.source === 'demo'
          ? 'Demo simulator'
          : 'Hardware adapter',
      okay: status === 'live',
      note: status === 'live' ? 'Receiving readings every second' : 'Waiting for fresh readings',
    },
    {
      icon: Server,
      label: 'Backend API',
      value: local || result.error ? 'Unavailable' : d ? 'Connected' : 'Checking',
      okay: !local && !!d && !result.error,
      note: 'FastAPI · REST + WebSocket',
    },
    {
      icon: Database,
      label: 'Database',
      value: d?.database === 'connected' ? 'Connected' : 'Unavailable',
      okay: d?.database === 'connected',
      note: local
        ? 'Local reading history · not uploaded'
        : d?.database_engine === 'sqlite'
          ? 'SQLite · local storage'
          : 'PostgreSQL',
    },
    {
      icon: Wifi,
      label: 'Live connection',
      value: status === 'live' ? 'Streaming' : status === 'waiting' ? 'Waiting' : 'Disconnected',
      okay: status === 'live',
      note: local
        ? 'Direct Bluetooth notifications'
        : `${d?.websocket_clients ?? 0} connected client(s)`,
    },
  ]
  return (
    <div className="page-enter">
      <PageHeading title="Device status" action={<ConnectionBadge />} />
      {result.error && <ErrorState message={result.error} retry={result.refresh} />}{' '}
      {result.loading && !d ? (
        <Loading />
      ) : (
        <>
          <Panel className="device-hero">
            <div className="device-visual">
              <Cpu size={48} />
              <span className={`device-led ${status === 'live' ? 'on' : ''}`} />
            </div>
            <div>
              <Badge tone={status === 'live' ? 'green' : 'amber'}>
                {local
                  ? 'BLUETOOTH INPUT ADAPTER'
                  : d?.source === 'demo'
                    ? 'DEMO DATA SOURCE ACTIVE'
                    : 'HARDWARE INPUT ADAPTER'}
              </Badge>
              <h2>Main power supply</h2>
              <p>
                {local
                  ? 'Receiving measurements directly from SmartPowerMonitor over Bluetooth.'
                  : d?.source === 'demo'
                    ? 'A realistic software source powers this workspace.'
                    : 'Accepting validated ESP32 / PZEM readings via the ingestion API.'}
              </p>
              <span className="muted-text">Single-phase AC · {d?.timezone}</span>
            </div>
            <div className="device-uptime">
              <Clock3 size={17} />
              <span>{local ? 'Cloud uptime unavailable' : 'System uptime'}</span>
              <strong>
                {local
                  ? '—'
                  : `${Math.floor((d?.uptime_seconds || 0) / 3600)}h ${Math.floor(((d?.uptime_seconds || 0) % 3600) / 60)}m`}
              </strong>
            </div>
          </Panel>
          <div className="device-cards">
            {cards.map((c) => (
              <Panel key={c.label}>
                <c.icon size={23} className="muted-text" />
                <span>{c.label}</span>
                <h2>{c.value}</h2>
                <p>
                  <span className={`tiny-dot ${c.okay ? 'green' : 'amber'}`} />
                  {c.note}
                </p>
              </Panel>
            ))}
          </div>
          <div className="two-grid">
            <Panel>
              <div className="panel-title">
                <h2>Telemetry details</h2>
                <Cable size={18} className="green-text" />
              </div>
              <div className="detail-list">
                {[
                  ['Latest reading', time(latest?.timestamp, true)],
                  ['Reading age', `${number(age, 1)} seconds`],
                  [local ? 'Session readings' : 'Stored readings', number(d?.reading_count, 0)],
                  ['Open alerts', number(latest?.active_alert_count ?? d?.active_alerts, 0)],
                  [
                    'Storage size',
                    local
                      ? 'Local browser storage'
                      : d?.storage_bytes == null
                        ? 'Managed by PostgreSQL'
                        : `${number(d.storage_bytes / 1048576, 2)} MB`,
                  ],
                  ['Live frequency', '1 Hz'],
                  [
                    'Raw data retention',
                    local ? 'Latest 10,000 BLE readings' : 'No automatic deletion',
                  ],
                ].map(([k, v]) => (
                  <div key={k}>
                    <span>{k}</span>
                    <strong>{v}</strong>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel>
              <div className="panel-title">
                <h2>Ready for real hardware</h2>
                <Badge>ESP32 / PZEM</Badge>
              </div>
              <p className="paragraph-muted">
                Your dashboard uses the same data contract for simulation and real measurements. The
                hardware adapter validates and stores readings before broadcasting them.
              </p>
              <div className="hardware-steps">
                <div>
                  <b>1</b>
                  <span>Configure hardware mode in the backend environment.</span>
                </div>
                <div>
                  <b>2</b>
                  <span>Set an ingestion key and connect your ESP32.</span>
                </div>
                <div>
                  <b>3</b>
                  <span>Send timestamped readings to the ingestion endpoint.</span>
                </div>
              </div>
              <code className="endpoint-code">POST /api/readings</code>
              <p className="card-footnote">
                Setup details and an example request are in the project README.
              </p>
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}
