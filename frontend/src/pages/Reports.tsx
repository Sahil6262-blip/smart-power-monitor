import { useState } from 'react'
import { FileChartColumn, FileDown, Info } from 'lucide-react'
import { useResource } from '../hooks/useResource'
import type { Summary } from '../types'
import { SummaryStats } from '../components/Metrics'
import { defaultRange, RangeFilter, rangeQuery } from '../components/RangeFilter'
import {
  Badge,
  Empty,
  ErrorState,
  ExportButton,
  Loading,
  PageHeading,
  Panel,
} from '../components/UI'
import { date, money, number, time } from '../utils/format'

export default function Reports() {
  const [range, setRange] = useState(defaultRange)
  const query = rangeQuery(range)
  const result = useResource<Summary>(query ? `/reports?${query}` : null)
  const s = result.data
  return (
    <div className="page-enter">
      <PageHeading
        eyebrow="FROM READINGS TO UNDERSTANDING"
        title="Energy reports"
        description="A concise, exportable view of how your energy was used."
        action={
          query && <ExportButton path={`/reports/export?${query}`} filename="energy-report.csv" />
        }
      />
      <div className="filter-bar">
        <RangeFilter value={range} onChange={setRange} />
        <Badge>CSV available</Badge>
      </div>
      {result.error ? (
        <ErrorState message={result.error} retry={result.refresh} />
      ) : !query ? (
        <Empty
          title="Choose a report period"
          text="Select valid start and end dates to generate your report."
        />
      ) : result.loading ? (
        <Loading />
      ) : (
        <>
          <Panel className="report-sheet">
            <div className="report-header">
              <div className="report-icon">
                <FileChartColumn size={28} />
              </div>
              <div>
                <div className="eyebrow">SMART POWER MONITOR</div>
                <h2>Energy performance report</h2>
                <p>
                  {s ? `${date(s.start)} ${time(s.start)} — ${date(s.end)} ${time(s.end)}` : '—'}
                </p>
              </div>
              <Badge tone={s?.source === 'demo' ? 'amber' : 'green'}>
                {s?.source === 'demo' ? 'Simulated data' : 'Hardware data'}
              </Badge>
            </div>
            <SummaryStats summary={s} />
            <div className="report-details">
              {[
                [
                  'Peak recorded at',
                  `${s?.peak_time ? date(s.peak_time) : '—'} · ${time(s?.peak_time)}`,
                ],
                ['Average power factor', number(s?.average_pf, 3)],
                ['Minimum voltage', `${number(s?.min_voltage, 1)} V`],
                ['Maximum voltage', `${number(s?.max_voltage, 1)} V`],
                ['Alerts recorded', number(s?.alert_count, 0)],
                ['Readings in period', number(s?.reading_count, 0)],
                ['Electricity tariff', `${money(s?.tariff)} / kWh`],
                ['Cost calculation', 'Meter energy delta × tariff'],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="report-note">
              <Info size={16} />
              <p>
                Costs are estimates based on your current flat tariff. Taxes, fixed charges, and
                slab pricing are excluded. Demo history is synthetic.
              </p>
            </div>
          </Panel>
          <div className="two-grid">
            <Panel className="export-card">
              <FileDown size={23} />
              <div>
                <h2>Raw readings</h2>
                <p>Download the complete reading log for your selected period.</p>
              </div>
              <ExportButton path={`/history/export?${query}`} label="Download CSV" />
            </Panel>
            <Panel className="export-card">
              <FileChartColumn size={23} />
              <div>
                <h2>PDF reports</h2>
                <p>The report service is ready for a PDF renderer in a future release.</p>
              </div>
              <Badge>Planned</Badge>
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}
