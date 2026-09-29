import { useId } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Reading } from '../types'
import { date, number, time } from '../utils/format'
import { Empty } from './UI'
import { Radio } from 'lucide-react'

export type Parameter = 'power' | 'voltage' | 'current' | 'frequency' | 'power_factor'
export const parameters: Record<Parameter, { label: string; unit: string; color: string }> = {
  power: { label: 'Active power', unit: 'W', color: '#b6ef83' },
  voltage: { label: 'Voltage', unit: 'V', color: '#78b4fa' },
  current: { label: 'Current', unit: 'A', color: '#b69cf5' },
  frequency: { label: 'Frequency', unit: 'Hz', color: '#eebc72' },
  power_factor: { label: 'Power factor', unit: '', color: '#72d8c5' },
}
const tooltipStyle = {
  background: '#1b242e',
  border: '1px solid #34404e',
  borderRadius: 10,
  color: '#eef3f8',
  fontSize: 12,
}

export function TrendChart({
  points,
  parameter = 'power',
  height = 255,
  longRange = false,
}: {
  points: Reading[]
  parameter?: Parameter
  height?: number
  longRange?: boolean
}) {
  const id = useId().replaceAll(':', '')
  const meta = parameters[parameter]
  if (!points.length)
    return (
      <div className="chart-awaiting" style={{ minHeight: height }}>
        <div className="awaiting-grid" aria-hidden="true" />
        <span className="awaiting-signal" aria-hidden="true">
          <Radio size={24} />
        </span>
        <Empty
          title="Waiting for readings"
          text="Your live trend will appear when the data source connects."
        />
      </div>
    )
  const data = points.map((p) => ({ ...p, x: Date.parse(p.timestamp) }))
  return (
    <div
      className="chart-container"
      style={{ height }}
      role="img"
      aria-label={`${meta.label} over time, ${points.length} readings`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 7, left: -19, bottom: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={meta.color} stopOpacity={0.32} />
              <stop offset="95%" stopColor={meta.color} stopOpacity={0.005} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#27303a" strokeDasharray="3 5" vertical={false} />
          <XAxis
            dataKey="x"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(v) =>
              longRange
                ? date(new Date(v).toISOString())
                : time(new Date(v).toISOString(), points.length <= 60)
            }
            axisLine={false}
            tickLine={false}
            minTickGap={42}
            tick={{ fill: '#768493', fontSize: 10 }}
            dy={10}
          />
          <YAxis
            domain={
              parameter === 'power' || parameter === 'current' ? [0, 'auto'] : ['auto', 'auto']
            }
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#768493', fontSize: 10 }}
            tickFormatter={(v) =>
              number(v, parameter === 'power_factor' || parameter === 'current' ? 2 : 0)
            }
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(v) =>
              `${date(new Date(Number(v)).toISOString())} · ${time(new Date(Number(v)).toISOString(), true)}`
            }
            formatter={(v) => [
              `${number(Number(v), parameter === 'current' || parameter === 'power_factor' ? 3 : 1)} ${meta.unit}`,
              meta.label,
            ]}
          />
          <Area
            type="monotone"
            dataKey={parameter}
            stroke={meta.color}
            strokeWidth={2.5}
            fill={`url(#${id})`}
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 4, stroke: '#121a22', strokeWidth: 3 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function EnergyChart({
  data,
  hourly = false,
  height = 255,
}: {
  data: { timestamp: string; energy_kwh: number }[]
  hourly?: boolean
  height?: number
}) {
  if (!data.length)
    return <Empty title="No consumption yet" text="Energy usage will appear as readings arrive." />
  return (
    <div
      className="chart-container"
      style={{ height }}
      role="img"
      aria-label="Energy consumption in kilowatt-hours"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 10, right: 0, left: -20, bottom: 0 }}
          barCategoryGap="35%"
        >
          <CartesianGrid stroke="#27303a" strokeDasharray="3 5" vertical={false} />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(v) => (hourly ? time(v) : date(v))}
            axisLine={false}
            tickLine={false}
            minTickGap={26}
            tick={{ fill: '#768493', fontSize: 10 }}
            dy={10}
          />
          <YAxis axisLine={false} tickLine={false} tick={{ fill: '#768493', fontSize: 10 }} />
          <Tooltip
            cursor={{ fill: '#ffffff05' }}
            contentStyle={tooltipStyle}
            labelFormatter={(v) => `${date(String(v))} · ${time(String(v))}`}
            formatter={(v) => [`${number(Number(v), 3)} kWh`, 'Energy']}
          />
          <Bar
            dataKey="energy_kwh"
            fill="#8fc7a2"
            radius={[4, 4, 0, 0]}
            maxBarSize={46}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
