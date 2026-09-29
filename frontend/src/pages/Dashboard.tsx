import { useState } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useLive } from '../context/LiveContext'
import { useResource } from '../hooks/useResource'
import type { Alert, Reading } from '../types'
import { number, time, titleCase } from '../utils/format'
import { MetricCards, BudgetCard, HealthGauge, TodaySummary } from '../components/Metrics'
import { TrendChart } from '../components/Charts'
import { EnergyHero } from '../components/EnergyHero'
import {
  Badge,
  ErrorState,
  ExportButton,
  Loading,
  PageHeading,
  Panel,
  Tabs,
} from '../components/UI'

export default function Dashboard() {
  const { latest, points, age, revision, settings, status, device } = useLive()
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
  return (
    <div className="page-enter dashboard-page">
      <PageHeading
        eyebrow="WORKSPACE / OVERVIEW"
        title="Energy overview"
        description="A live look at your power. Every watt, every second."
        action={
          <>
            <span className="date-chip">
              Main power supply <ChevronRight size={13} />
            </span>
            <ExportButton
              path="/reports/export?range=today"
              filename="today-summary.csv"
              label="Export report"
            />
          </>
        }
      />
      <EnergyHero />
      <div className="section-kicker">
        <div>
          <span className={`status-dot ${status === 'live' ? 'pulse green-text' : 'amber-text'}`} />{' '}
          LIVE PARAMETERS <span className="section-divider" />{' '}
          <span className="normal-case">
            {device?.source === 'hardware'
              ? 'Hardware source'
              : device?.source === 'demo'
                ? 'Demo data source'
                : 'Connecting to source'}
          </span>
        </div>
        <span>
          {age === null ? 'Connecting to your source…' : `Last update ${number(age, 1)}s ago`}{' '}
          <span className="refresh-dot">↻</span>
        </span>
      </div>
      <MetricCards />
      <div className="dashboard-primary">
        <Panel className="power-panel">
          <div className="panel-title">
            <div>
              <h2>
                Live power trend{' '}
                <span className="live-small">
                  <span className="tiny-dot green" /> 1s
                </span>
              </h2>
              <p>See how your demand changes over time</p>
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
            <strong>
              {number(latest?.power, 1)}
              <small>W</small>
            </strong>
            <span>
              <span className="tiny-dot green" /> Active power
            </span>
            <span className="trend-source">
              {range === 'live' || range === '1m'
                ? 'Last 60 readings'
                : 'Sampled historical readings'}
            </span>
          </div>
          {historical.error ? (
            <ErrorState message={historical.error} retry={historical.refresh} />
          ) : historical.loading && range !== 'live' && range !== '1m' ? (
            <Loading />
          ) : (
            <TrendChart
              points={
                range === 'live' || range === '1m' ? points.slice(-60) : historical.data || []
              }
            />
          )}
          <div className="chart-footer">
            <span>Power (W)</span>
            <span>
              {range === 'live' || range === '1m'
                ? 'Updates every second'
                : 'Historical samples · refreshes every 30s'}
            </span>
          </div>
        </Panel>
        <HealthGauge health={latest?.health_score} />
      </div>
      <div className="dashboard-secondary">
        <TodaySummary summary={latest?.today} />
        <Panel className="system-panel">
          <div className="panel-title">
            <h2>System health</h2>
            <ShieldCheck
              size={18}
              className={latest?.active_alert_count === 0 ? 'green-text' : 'amber-text'}
            />
          </div>
          <div className="system-checks">
            {checks.map(([label, okay, detail]) => (
              <div key={label}>
                <span className={`check-icon ${!latest ? 'muted' : okay ? 'green' : 'amber'}`}>
                  {okay && latest ? <Check size={13} /> : <TriangleAlert size={13} />}
                </span>
                <div>
                  <strong>{label}</strong>
                  <p>
                    {!latest ? 'Waiting for a reading' : okay ? detail : 'Needs your attention'}
                  </p>
                </div>
                <span
                  className={`check-state ${!latest ? '' : okay ? 'green-text' : 'amber-text'}`}
                >
                  {!latest ? '—' : okay ? 'Normal' : 'Review'}
                </span>
              </div>
            ))}
          </div>
          <Link className="panel-link" to="/device">
            View device status <ArrowUpRight size={15} />
          </Link>
        </Panel>
        <div className="dashboard-side-stack">
          <BudgetCard budget={latest?.budget} compact />
          <Link to="/insights" className="insight-teaser">
            <span className="insight-symbol">
              <Sparkles size={20} />
            </span>
            <div>
              <div>
                Smarter energy starts here <Badge tone="purple">Coming next</Badge>
              </div>
              <p>Explore what’s next with AI insights.</p>
            </div>
            <ArrowUpRight size={17} />
          </Link>
        </div>
      </div>
      <Panel className="recent-panel">
        <div className="panel-title">
          <div className="flex items-center gap-3">
            <h2>Recent activity</h2>
            <Badge>{latest?.active_alert_count ?? '—'} open alerts</Badge>
          </div>
          <Link to="/alerts" className="text-link">
            View all alerts <ArrowRight size={14} />
          </Link>
        </div>
        {alerts.error ? (
          <ErrorState message={alerts.error} retry={alerts.refresh} />
        ) : !alerts.data?.length ? (
          <p className="muted-text">No alerts recorded. We’ll keep an eye on things.</p>
        ) : (
          <div className="recent-list">
            {alerts.data.map((alert) => (
              <div className="recent-row" key={alert.id}>
                <span className={`activity-icon ${alert.severity}`}>
                  <Check size={15} />
                </span>
                <div>
                  <strong>{titleCase(alert.type)}</strong>
                  <p>{alert.message}</p>
                </div>
                <Badge tone={alert.status === 'resolved' ? 'green' : 'amber'}>
                  {titleCase(alert.status)}
                </Badge>
                <time>{time(alert.timestamp)}</time>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
