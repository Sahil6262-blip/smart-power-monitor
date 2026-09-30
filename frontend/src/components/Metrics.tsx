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
import { money, number } from '../utils/format'
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
        `${index ? 'L' : 'M'}${(index / (values.length - 1)) * 160},${max === min ? 18 : 29 - ((value - min) / span) * 23}`,
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
    color: 'orange',
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
  const factors = health?.factors.filter((factor) => factor.penalty > 0) || []
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
      <div className="health-content">
        <div className="gauge-wrap">
          <svg
            viewBox="0 0 120 120"
            role="img"
            aria-label={`Energy health score ${health ? value : 'unavailable'} out of 100`}
          >
            <circle cx="60" cy="60" r="51" fill="none" stroke="#edf0f7" strokeWidth="5" />
            <circle
              cx="60"
              cy="60"
              r="51"
              fill="none"
              stroke={value >= 75 ? '#5676ed' : '#eaa251'}
              strokeWidth="5"
              strokeLinecap="round"
              pathLength="100"
              strokeDasharray={`${value} 100`}
              transform="rotate(-90 60 60)"
              className="gauge-path"
              opacity={health ? 1 : 0}
            />
            <circle cx="60" cy="60" r="41" fill="none" stroke="#dbe2ef" strokeDasharray="1 5" />
          </svg>
          <div className="gauge-value">
            <strong>{health ? value : '—'}</strong>
            <small>OUT OF 100</small>
          </div>
        </div>
        <div className="health-description">
          <Badge tone={!health ? 'muted' : value >= 75 ? 'green' : 'amber'}>
            {health?.label || 'Awaiting data'}
          </Badge>
          <p>
            {!health
              ? 'Your energy health will appear with the first reading.'
              : factors.length
                ? `${factors.length} factor${factors.length === 1 ? '' : 's'} affecting your score.`
                : 'Your readings are within the configured limits.'}
          </p>
        </div>
      </div>
      <details className="score-details">
        <summary>
          What goes into this score? <ArrowUpRight size={12} />
        </summary>
        <p>
          Application metric, not an industry certification. Start at 100, subtract the penalties
          below.
        </p>
        {health?.factors.map((factor) => (
          <div key={factor.name}>
            <span>{factor.name}</span>
            <b>−{factor.penalty}</b>
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
