import { useState } from 'react'
import { Radio } from 'lucide-react'
import { useLive } from '../context/LiveContext'
import { MetricCards } from '../components/Metrics'
import { parameters, TrendChart } from '../components/Charts'
import type { Parameter } from '../components/Charts'
import { Badge, PageHeading, Panel, Tabs } from '../components/UI'
import { ConnectionBadge } from '../components/Shell'
import { number, time } from '../utils/format'

export default function LiveMonitoring() {
  const { points, latest, age } = useLive()
  const [parameter, setParameter] = useState<Parameter>('power')
  const [window, setWindow] = useState('60')
  const visible = points.slice(-Number(window))
  return (
    <div className="page-enter">
      <PageHeading
        eyebrow="REAL-TIME TELEMETRY"
        title="Live monitoring"
        description="Your electrical signature, one second at a time."
        action={<ConnectionBadge />}
      />
      <MetricCards />
      <Panel className="live-chart-panel">
        <div className="panel-title">
          <div>
            <h2>{parameters[parameter].label} over time</h2>
            <p>
              Latest {visible.length} readings · {parameters[parameter].unit || 'ratio'}
            </p>
          </div>
          <Tabs
            value={window}
            onChange={setWindow}
            items={[
              { value: '60', label: '60 points' },
              { value: '180', label: '180 points' },
              { value: '300', label: '300 points' },
            ]}
          />
        </div>
        <div className="parameter-tabs">
          <Tabs
            value={parameter}
            onChange={setParameter}
            items={Object.entries(parameters).map(([value, meta]) => ({
              value: value as Parameter,
              label: meta.label,
            }))}
          />
        </div>
        <TrendChart points={visible} parameter={parameter} height={340} />
        <div className="chart-footer">
          <span>
            <Radio size={13} /> WebSocket stream · 1 Hz
          </span>
          <span>
            Last update: {time(latest?.timestamp, true)} · {number(age, 1)}s ago
          </span>
        </div>
      </Panel>
      <div className="two-grid">
        {(['voltage', 'current'] as const).map((p) => (
          <Panel key={p}>
            <div className="panel-title">
              <h2>{parameters[p].label}</h2>
              <Badge>
                {number(latest?.[p], p === 'current' ? 3 : 1)} {parameters[p].unit}
              </Badge>
            </div>
            <TrendChart points={visible} parameter={p} height={200} />
          </Panel>
        ))}
      </div>
    </div>
  )
}
