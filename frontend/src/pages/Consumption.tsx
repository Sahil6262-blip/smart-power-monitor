import { useState } from 'react'
import { BatteryCharging } from 'lucide-react'
import { useResource } from '../hooks/useResource'
import { useLive } from '../context/LiveContext'
import type { Consumption as ConsumptionData } from '../types'
import { EnergyChart } from '../components/Charts'
import { BudgetCard, SummaryStats } from '../components/Metrics'
import { ErrorState, ExportButton, Loading, PageHeading, Panel, Tabs } from '../components/UI'
import { money, time } from '../utils/format'

const views = {
  hourly: ['today', 'hourly'],
  daily: ['week', 'daily'],
  weekly: ['30d', 'weekly'],
  monthly: ['30d', 'monthly'],
} as const
export default function Consumption() {
  const [view, setView] = useState<keyof typeof views>('hourly')
  const { latest, revision } = useLive()
  const [period, granularity] = views[view]
  const result = useResource<ConsumptionData>(
    `/consumption/${period}?granularity=${granularity}`,
    revision,
    30000,
  )
  return (
    <div className="page-enter">
      <PageHeading
        title="Consumption"
        action={<ExportButton path={`/reports/export?range=${period}`} />}
      />
      {result.error && <ErrorState message={result.error} retry={result.refresh} />}
      <Panel>
        <div className="panel-title">
          <h2>
            {view === 'hourly' ? 'Today' : view === 'daily' ? 'Last 7 days' : 'Last 30 days'} at a
            glance
          </h2>
          <BatteryCharging size={20} className="green-text" />
        </div>
        {result.loading ? <Loading /> : <SummaryStats summary={result.data?.summary} />}
        <div className="summary-footnote">
          Peak {time(result.data?.summary.peak_time)} · Estimated cost at{' '}
          {money(result.data?.summary.tariff)} / kWh
        </div>
      </Panel>
      <Panel className="consumption-chart">
        <div className="panel-title">
          <div>
            <h2>Energy consumption</h2>
            <p>
              {view === 'weekly'
                ? 'Seven-day buckets across the last 30 days'
                : view === 'monthly'
                  ? 'Calendar-month buckets across the last 30 days'
                  : 'Energy in kWh'}
            </p>
          </div>
          <Tabs
            value={view}
            onChange={setView}
            items={Object.keys(views).map((v) => ({
              value: v as keyof typeof views,
              label: v[0].toUpperCase() + v.slice(1),
            }))}
          />
        </div>
        {!result.loading && (
          <EnergyChart data={result.data?.buckets || []} hourly={view === 'hourly'} height={320} />
        )}
      </Panel>
      <BudgetCard budget={latest?.budget} />
    </div>
  )
}
