import { useState } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleAlert,
  Radio,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useLive } from '../context/LiveContext'
import { useResource } from '../hooks/useResource'
import type { Alert, Reading } from '../types'
import { number, time, titleCase } from '../utils/format'
import { MetricCards, BudgetCard, HealthGauge } from '../components/Metrics'
import { TrendChart } from '../components/Charts'
import { EnergyHero } from '../components/EnergyHero'
import {
  Badge,
  Empty,
  ErrorState,
  ExportButton,
  Loading,
  PageHeading,
  Panel,
  Tabs,
} from '../components/UI'

export default function Dashboard() {
  const { latest, points, age, revision, settings, status, device, mode } = useLive()
  const [range, setRange] = useState('live')
  const historical = useResource<Reading[]>(
    range !== 'live' && range !== '1m' ? `/history/trend?range=${range}&points=240` : null,
    revision,
    30000,
  )
  const alerts = useResource<Alert[]>('/alerts?limit=3', revision, 30000)
  const checks = [
    [
      'Voltage stability',
      !!latest &&
        !!settings &&
        latest.voltage >= settings.min_voltage &&
        latest.voltage <= settings.max_voltage,
      'Within configured range',
    ],
    [
      'Load level',
      !!latest &&
        !!settings &&
        latest.power <= settings.max_power &&
        latest.current <= settings.max_current,
      'Within your load limits',
    ],
    [
      'Power factor',
      !!latest && !!settings && latest.power_factor >= settings.min_power_factor,
      'Efficient power delivery',
    ],
    ['Usage alerts', latest?.active_alert_count === 0, 'No active abnormal usage'],
  ] as const
  const isLiveRange = range === 'live' || range === '1m'
  const chartPoints = isLiveRange ? points.slice(-60) : historical.data || []
  const knownPower = chartPoints.map((point) => point.power)
  const minimum = knownPower.length ? Math.min(...knownPower) : undefined
  const maximum = knownPower.length ? Math.max(...knownPower) : undefined

  return (
    <div className="page-enter dashboard-page">
      <PageHeading
        title="Energy overview"
        action={<ExportButton path="/reports/export?range=today" label="Export report" />}
      />
      <EnergyHero />
      <div className="section-kicker">
        <div>
          <span className={`status-dot ${status === 'live' ? 'pulse green-text' : 'amber-text'}`} />{' '}
          LIVE PARAMETERS <span className="section-divider" />
          <span className="normal-case">
            {mode === 'offline-device'
              ? 'Direct Bluetooth'
              : device?.source === 'hardware'
                ? 'Hardware source'
                : device?.source === 'demo'
                  ? 'Demo data source'
                  : 'Connecting to source'}
          </span>
        </div>
        <span>
          <Radio size={12} />
          {age === null ? 'Waiting for a first reading' : `Updated ${number(age, 1)}s ago`}
        </span>
      </div>
      <MetricCards />
      <div className="dashboard-primary">
        <Panel className="power-panel">
          <div className="panel-title">
            <div>
              <h2>Live power trend</h2>
            </div>
            <Tabs
              value={range}
              onChange={setRange}
              items={[
                { value: 'live', label: 'Live' },
                { value: '1m', label: '1 min' },
                { value: '10m', label: '10 min' },
                { value: '1h', label: '1 hr' },
                { value: 'today', label: 'Today' },
              ]}
            />
          </div>
          <div className="trend-headline">
            <div>
              <strong>
                {number(latest?.power, 1)}
                <small>W</small>
              </strong>
              <span className="trend-legend">
                <span className="tiny-dot orange" /> Active power{' '}
                {status !== 'live' && latest ? '· last known' : ''}
              </span>
            </div>
            <div className="trend-extremes">
              <div>
                <span>LOW</span>
                <strong>
                  {number(minimum, 1)}
                  <small>W</small>
                </strong>
              </div>
              <div>
                <span>HIGH</span>
                <strong>
                  {number(maximum, 1)}
                  <small>W</small>
                </strong>
              </div>
            </div>
          </div>
          {historical.error ? (
            <ErrorState message={historical.error} retry={historical.refresh} />
          ) : historical.loading && !isLiveRange ? (
            <Loading />
          ) : (
            <TrendChart points={chartPoints} height={260} />
          )}
          <div className="chart-footer">
            <span>
              <span className="tiny-dot orange" /> Power in watts
            </span>
            <span>
              {mode === 'offline-device'
                ? 'Bluetooth session · browser receipt time'
                : isLiveRange
                  ? 'Last 60 readings · 1s updates'
                  : 'Historical samples · 30s refresh'}
            </span>
          </div>
        </Panel>
        <div className="dashboard-insights">
          <HealthGauge health={latest?.health_score} />
          <BudgetCard budget={latest?.budget} compact />
        </div>
      </div>
      <div className="dashboard-secondary">
        <Panel className="system-panel">
          <div className="panel-title">
            <div>
              <h2>System health</h2>
            </div>
            <ShieldCheck
              size={21}
              className={
                status === 'live' && latest?.active_alert_count === 0 ? 'green-text' : 'muted-text'
              }
            />
          </div>
          <div className="system-checks">
            {checks.map(([label, okay, detail]) => (
              <div key={label}>
                <span
                  className={`check-icon ${status !== 'live' ? 'muted' : okay ? 'green' : 'amber'}`}
                >
                  {status === 'live' && okay ? <Check size={14} /> : <CircleAlert size={14} />}
                </span>
                <div>
                  <strong>{label}</strong>
                  <p>
                    {!latest
                      ? 'Awaiting measurement'
                      : status !== 'live'
                        ? 'Reading is no longer live'
                        : okay
                          ? detail
                          : 'Needs your attention'}
                  </p>
                </div>
                <span
                  className={`check-state ${status !== 'live' ? '' : okay ? 'green-text' : 'amber-text'}`}
                >
                  {status !== 'live' ? 'Pending' : okay ? 'Normal' : 'Review'}
                </span>
              </div>
            ))}
          </div>
          <Link className="panel-link" to="/device">
            View device status <ArrowUpRight size={15} />
          </Link>
        </Panel>
        <Panel className="recent-panel">
          <div className="panel-title">
            <div>
              <h2>
                Recent events{' '}
                <Badge>{latest?.active_alert_count ?? device?.active_alerts ?? '—'} open</Badge>
              </h2>
            </div>
            <Link to="/alerts" className="text-link" aria-label="View all alerts">
              <ArrowUpRight size={19} />
            </Link>
          </div>
          {alerts.error ? (
            <ErrorState message={alerts.error} retry={alerts.refresh} />
          ) : alerts.loading ? (
            <Loading />
          ) : !alerts.data?.length ? (
            <Empty title="A quiet moment" text="New alerts and resolved events will appear here." />
          ) : (
            <div className="recent-list">
              {alerts.data.map((alert) => (
                <div className="recent-row" key={alert.id}>
                  <span className={`activity-icon ${alert.severity}`}>
                    {alert.status === 'resolved' ? <Check size={16} /> : <CircleAlert size={16} />}
                  </span>
                  <div>
                    <strong>{titleCase(alert.type)}</strong>
                    <p>{alert.message}</p>
                    <span className="event-meta">
                      {time(alert.timestamp)} <span>·</span> {titleCase(alert.status)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Link className="panel-link" to="/alerts">
            Open alert center <ArrowRight size={15} />
          </Link>
        </Panel>
      </div>
      <Link to="/insights" className="insight-teaser">
        <span className="insight-symbol">
          <Sparkles size={22} />
        </span>
        <div>
          <div>
            Forecast your energy use. <Badge tone="purple">Live estimates</Badge>
          </div>
          <p>See projected consumption and cost from your recent circuit readings.</p>
        </div>
        <span className="insight-link-label">View predictions</span>
        <ArrowUpRight size={19} />
      </Link>
    </div>
  )
}
