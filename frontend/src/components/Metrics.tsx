import {
  Activity,
  ArrowUpRight,
  BatteryCharging,
  CircleGauge,
  Radio,
  Waves,
  Zap,
} from 'lucide-react'
import { useLive } from '../context/LiveContext'
import type { Budget, HealthScore, Summary } from '../types'
import { money, number, time } from '../utils/format'
import { Badge, Panel } from './UI'
import type { Reading } from '../types'

function MetricSparkline({
  points,
  parameter,
}: {
  points: Reading[]
  parameter: 'voltage' | 'current' | 'power' | 'energy' | 'frequency' | 'power_factor'
}) {
  const values = points.slice(-36).map((point) => point[parameter])
  if (values.length < 2)
    return (
      <div className="metric-sparkline sparkline-pending" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    )
  const min = Math.min(...values),
    max = Math.max(...values)
  const span = max - min || 1
  const path = values
    .map(
      (value, index) =>
        `${index ? 'L' : 'M'}${(index / (values.length - 1)) * 160},${29 - ((value - min) / span) * 23}`,
    )
    .join(' ')
  return (
    <svg
      className="metric-sparkline"
      viewBox="0 0 160 36"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={`${path} L160,36 L0,36 Z`} fill="currentColor" opacity="0.06" />
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

const metrics = [
  {
    key: 'voltage',
    label: 'Voltage',
    unit: 'V',
    digits: 1,
    icon: Zap,
    color: 'blue',
    note: 'Supply voltage',
  },
  {
    key: 'current',
    label: 'Current',
    unit: 'A',
    digits: 3,
    icon: Waves,
    color: 'purple',
    note: 'Current draw',
  },
  {
    key: 'power',
    label: 'Active power',
    unit: 'W',
    digits: 1,
    icon: Activity,
    color: 'green',
    note: 'Instantaneous load',
  },
  {
    key: 'energy',
    label: 'Total energy',
    unit: 'kWh',
    digits: 3,
    icon: BatteryCharging,
    color: 'teal',
    note: 'Cumulative meter',
  },
  {
    key: 'frequency',
    label: 'Frequency',
    unit: 'Hz',
    digits: 2,
    icon: Radio,
    color: 'amber',
    note: 'Grid frequency',
  },
  {
    key: 'power_factor',
    label: 'Power factor',
    unit: '',
    digits: 3,
    icon: CircleGauge,
    color: 'pink',
    note: 'Real / apparent power',
  },
] as const

export function MetricCards() {
  const { latest, status, points } = useLive()
  return (
    <div className={`metrics-grid ${status !== 'live' ? 'stale' : ''}`}>
      {metrics.map((metric) => (
        <Panel
          className={`metric-card metric-${metric.key} accent-${metric.color}`}
          key={metric.key}
        >
          <div className="metric-top">
            <span>{metric.label}</span>
            <span className={`metric-icon ${metric.color}`}>
              <metric.icon size={16} />
            </span>
          </div>
          <div className="metric-value" data-testid={`metric-${metric.key}`}>
            {number(latest?.[metric.key], metric.digits)}
            <span>{metric.unit}</span>
          </div>
          <MetricSparkline points={points} parameter={metric.key} />
          <div className="metric-bottom">
            <span className={`tiny-dot ${status === 'live' ? metric.color : 'muted'}`} />
            {metric.note}
          </div>
        </Panel>
      ))}
    </div>
  )
}

export function SummaryStats({ summary }: { summary?: Summary | null }) {
  return (
    <div className="summary-stats">
      {[
        ['Energy consumed', number(summary?.energy_kwh, 3), 'kWh'],
        ['Estimated cost', money(summary?.estimated_cost), 'INR'],
        ['Average power', number(summary?.average_power, 1), 'W'],
        ['Peak demand', number(summary?.peak_power, 1), 'W'],
      ].map(([label, value, unit]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>
            {value}
            <small>{unit}</small>
          </strong>
        </div>
      ))}
    </div>
  )
}

export function HealthGauge({ health }: { health?: HealthScore }) {
  const value = health?.score ?? 0
  return (
    <Panel className="health-panel">
      <div className="panel-title">
        <h2>Energy health</h2>
        <span
          className="info-dot"
          title={health?.description || 'Application heuristic; not an industry-certified metric.'}
        >
          i
        </span>
      </div>
      <div className="gauge-wrap">
        <svg
          viewBox="0 0 200 150"
          role="img"
          aria-label={`Energy health score ${health ? value : 'unavailable'} out of 100`}
        >
          <path
            d="M 30 120 A 80 80 0 1 1 170 120"
            fill="none"
            stroke="#26332d"
            strokeWidth="10"
            strokeLinecap="round"
          />
          <path
            d="M 30 120 A 80 80 0 1 1 170 120"
            fill="none"
            stroke={value >= 75 ? '#b6ef83' : '#eebc72'}
            strokeWidth="10"
            strokeLinecap="round"
            pathLength="100"
            strokeDasharray={`${value} 100`}
            className="gauge-path"
          />
        </svg>
        <div className="gauge-value">
          <strong>
            {health ? value : '—'}
            <small>/100</small>
          </strong>
          <Badge tone={value >= 75 ? 'green' : 'amber'}>{health?.label || 'Waiting'}</Badge>
        </div>
      </div>
      <p className="health-caption">A clearer picture of your energy wellbeing.</p>
      <details className="score-details">
        <summary>
          How is this calculated? <ArrowUpRight size={12} />
        </summary>
        <p>
          Application metric, not an industry certification. Start at 100, subtract the penalties
          below.
        </p>
        {health?.factors.map((f) => (
          <div key={f.name}>
            <span>{f.name}</span>
            <b>−{f.penalty}</b>
          </div>
        ))}
      </details>
    </Panel>
  )
}

export function BudgetCard({
  budget,
  compact = false,
}: {
  budget?: Budget | null
  compact?: boolean
}) {
  return (
    <Panel className={`budget-panel ${compact ? 'compact' : ''}`}>
      <div className="panel-title">
        <h2>Monthly energy budget</h2>
        <Badge tone="muted">This month</Badge>
      </div>
      <div className="budget-numbers">
        <strong>
          {number(budget?.used, 1)}
          <small> / {number(budget?.target, 0)} kWh</small>
        </strong>
        <span>{number(budget?.percentage, 0)}%</span>
      </div>
      <div
        className={`progress-track ${budget && budget.percentage >= 100 ? 'over-budget' : ''}`}
        role="progressbar"
        aria-label="Monthly energy budget used"
        aria-valuenow={Math.min(100, budget?.percentage ?? 0)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div style={{ width: `${Math.min(100, budget?.percentage ?? 0)}%` }} />
      </div>
      <div className="budget-footer">
        <span>
          <span className="tiny-dot green" />{' '}
          {!budget
            ? 'Waiting for usage'
            : budget.percentage >= 100
              ? 'Budget exceeded'
              : 'Within your budget'}
        </span>
        <span>{number(budget?.remaining, 1)} kWh remaining</span>
      </div>
    </Panel>
  )
}

export function TodaySummary({ summary }: { summary?: Summary | null }) {
  return (
    <Panel className="today-panel">
      <div className="panel-title">
        <h2>Today at a glance</h2>
        <Badge>Today</Badge>
      </div>
      <div className="today-energy">
        <span className="today-icon">
          <BatteryCharging size={22} />
        </span>
        <div>
          <strong>
            {number(summary?.energy_kwh, 3)} <small>kWh</small>
          </strong>
          <p>Total energy consumed</p>
        </div>
      </div>
      <div className="today-rows">
        <div>
          <span>Estimated electricity cost</span>
          <strong>{money(summary?.estimated_cost)}</strong>
        </div>
        <div>
          <span>Average power</span>
          <strong>
            {number(summary?.average_power)} <small>W</small>
          </strong>
        </div>
        <div>
          <span>Peak power</span>
          <strong>
            {number(summary?.peak_power)} <small>W</small>
          </strong>
        </div>
        <div>
          <span>Peak recorded at</span>
          <strong>{time(summary?.peak_time)}</strong>
        </div>
      </div>
      <div className="card-footnote">Based on your tariff of {money(summary?.tariff)} / kWh</div>
    </Panel>
  )
}
