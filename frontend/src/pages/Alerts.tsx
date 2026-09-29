import { useState } from 'react'
import { Bell, Check, CheckCheck, CircleAlert, Filter } from 'lucide-react'
import { useResource } from '../hooks/useResource'
import { useLive } from '../context/LiveContext'
import { api } from '../services/api'
import type { Alert } from '../types'
import { date, number, time, titleCase } from '../utils/format'
import { Badge, Empty, ErrorState, Loading, PageHeading, Panel, Tabs } from '../components/UI'

const units: Record<string, string> = {
  high_voltage: 'V',
  low_voltage: 'V',
  high_current: 'A',
  high_power: 'W',
  sudden_power_increase: 'W',
  energy_budget_exceeded: 'kWh',
  data_connection_lost: 's',
}
export default function Alerts() {
  const { revision, latest } = useLive()
  const [status, setStatus] = useState('open'),
    [severity, setSeverity] = useState(''),
    [day, setDay] = useState('')
  const [offset, setOffset] = useState(0),
    [busy, setBusy] = useState<number | null>(null),
    [error, setError] = useState('')
  const params = new URLSearchParams({ limit: '25', offset: String(offset) })
  if (status) params.set('status', status)
  if (severity) params.set('severity', severity)
  if (day) {
    const start = new Date(`${day}T00:00:00`),
      end = new Date(start)
    end.setDate(end.getDate() + 1)
    params.set('start', start.toISOString())
    params.set('end', end.toISOString())
  }
  const result = useResource<Alert[]>(`/alerts?${params}`, revision, 30000)
  const mutate = async (id: number, state: string) => {
    setBusy(id)
    setError('')
    try {
      await api(`/alerts/${id}`, { method: 'PATCH', body: JSON.stringify({ status: state }) })
      result.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="page-enter">
      <PageHeading
        eyebrow="STAY A STEP AHEAD"
        title="Alerts & events"
        description="Know what needs attention, and keep a record of what’s resolved."
        action={
          <Badge tone={latest?.active_alert_count ? 'amber' : 'green'}>
            <Bell size={13} />
            {latest?.active_alert_count ?? '—'} open alerts
          </Badge>
        }
      />
      <div className="filter-bar">
        <Tabs
          value={status}
          onChange={(v) => {
            setStatus(v)
            setOffset(0)
          }}
          items={[
            { value: 'open', label: 'Active alerts' },
            { value: '', label: 'All history' },
            { value: 'resolved', label: 'Resolved' },
          ]}
        />
        <div className="filter-controls">
          <Filter size={15} />
          <select
            aria-label="Alert severity"
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value)
              setOffset(0)
            }}
          >
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
          <input
            aria-label="Alert date (browser timezone)"
            title="Date in your browser’s local timezone"
            type="date"
            value={day}
            onChange={(e) => {
              setDay(e.target.value)
              setOffset(0)
            }}
          />
          {day && (
            <button className="button small" onClick={() => setDay('')}>
              Clear date
            </button>
          )}
        </div>
      </div>
      {(error || result.error) && (
        <ErrorState message={error || result.error} retry={result.refresh} />
      )}{' '}
      {result.loading ? (
        <Loading />
      ) : !result.data?.length ? (
        <Panel>
          <Empty
            title={status === 'open' ? 'All clear. You’re in good shape.' : 'No events found'}
            text={
              status === 'open'
                ? 'Your alert engine is watching voltage, load, power factor, and energy use.'
                : 'Try a different date or severity filter.'
            }
          />
        </Panel>
      ) : (
        <div className="alerts-list">
          {result.data.map((alert) => (
            <Panel className={`alert-card severity-${alert.severity}`} key={alert.id}>
              <div className={`alert-symbol ${alert.severity}`}>
                <CircleAlert size={22} />
              </div>
              <div className="alert-content">
                <div className="alert-title">
                  <h2>{titleCase(alert.type)}</h2>
                  <Badge
                    tone={
                      alert.severity === 'critical'
                        ? 'red'
                        : alert.severity === 'warning'
                          ? 'amber'
                          : 'blue'
                    }
                  >
                    {titleCase(alert.severity)}
                  </Badge>
                  <Badge tone={alert.status === 'resolved' ? 'green' : 'muted'}>
                    {titleCase(alert.status)}
                  </Badge>
                </div>
                <p>{alert.message}</p>
                <div className="alert-values">
                  <span>
                    Measured{' '}
                    <strong>
                      {number(alert.measured_value, 2)} {units[alert.type]}
                    </strong>
                  </span>
                  <span>
                    Limit{' '}
                    <strong>
                      {number(alert.threshold_value, 2)} {units[alert.type]}
                    </strong>
                  </span>
                  <span>
                    Difference{' '}
                    <strong>
                      {alert.measured_value >= alert.threshold_value ? '+' : ''}
                      {number(alert.measured_value - alert.threshold_value, 2)} {units[alert.type]}
                    </strong>
                  </span>
                  <time>
                    {date(alert.timestamp)} · {time(alert.timestamp, true)}
                  </time>
                </div>
              </div>
              {alert.status !== 'resolved' && (
                <div className="alert-actions">
                  {alert.status === 'active' && (
                    <button
                      className="button small"
                      disabled={busy === alert.id}
                      onClick={() => mutate(alert.id, 'acknowledged')}
                    >
                      <Check size={14} />
                      Acknowledge
                    </button>
                  )}
                  <button
                    className="button small"
                    disabled={busy === alert.id}
                    onClick={() => mutate(alert.id, 'resolved')}
                  >
                    <CheckCheck size={14} />
                    Resolve
                  </button>
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}
      <div className="pagination">
        <span>
          Acknowledged alerts remain open until resolved. Ongoing faults can trigger again.
        </span>
        <div>
          <button
            className="button small"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - 25))}
          >
            Previous
          </button>
          <button
            className="button small"
            disabled={(result.data?.length || 0) < 25}
            onClick={() => setOffset((o) => o + 25)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
