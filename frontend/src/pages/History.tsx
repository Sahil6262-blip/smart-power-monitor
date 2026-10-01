import { useState } from 'react'
import { ChevronLeft, ChevronRight, Database } from 'lucide-react'
import { useResource } from '../hooks/useResource'
import { useLive } from '../context/LiveContext'
import type { Reading } from '../types'
import { date, number, time } from '../utils/format'
import { TrendChart, parameters } from '../components/Charts'
import type { Parameter } from '../components/Charts'
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

interface HistoryData {
  items: Reading[]
  total: number
  page: number
  page_size: number
}
export default function History() {
  const { mode } = useLive()
  const [range, setRange] = useState(defaultRange),
    [page, setPage] = useState(1),
    [parameter, setParameter] = useState<Parameter>('power')
  const query = rangeQuery(range)
  const history = useResource<HistoryData>(
    query ? `/history?${query}&page=${page}&page_size=20` : null,
  )
  const trend = useResource<Reading[]>(query ? `/history/trend?${query}&points=240` : null)
  return (
    <div className="page-enter">
      <PageHeading
        title="Historical data"
        description={
          mode === 'offline-device'
            ? 'Local Bluetooth history · Latest 10,000 readings · Receipt times'
            : undefined
        }
        action={query && <ExportButton path={`/history/export?${query}`} />}
      />
      <div className="filter-bar">
        <RangeFilter
          value={range}
          onChange={(r) => {
            setRange(r)
            setPage(1)
          }}
        />
        <Badge>
          <Database size={12} /> {number(history.data?.total, 0)} readings
        </Badge>
      </div>
      {!query ? (
        <Empty
          title="Choose your date range"
          text="Enter a start and end date, up to 93 days apart."
        />
      ) : (
        <>
          {history.error && <ErrorState message={history.error} retry={history.refresh} />}
          <Panel>
            <div className="panel-title">
              <div>
                <h2>Historical trend</h2>
                <p>
                  Sampled readings ·{' '}
                  {range.range === 'custom' ? 'Custom date range' : 'Selected period'}
                </p>
              </div>
              <select
                aria-label="Historical parameter"
                value={parameter}
                onChange={(e) => setParameter(e.target.value as Parameter)}
              >
                {Object.entries(parameters).map(([key, meta]) => (
                  <option key={key} value={key}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </div>
            {trend.error ? (
              <ErrorState message={trend.error} retry={trend.refresh} />
            ) : trend.loading ? (
              <Loading />
            ) : (
              <TrendChart
                points={trend.data || []}
                parameter={parameter}
                longRange={range.range !== 'today' && range.range !== 'yesterday'}
              />
            )}
          </Panel>
          <Panel className="table-panel">
            <div className="panel-title">
              <h2>Reading log</h2>
              <span className="muted-text">Newest first</span>
            </div>
            {history.loading ? (
              <Loading />
            ) : !history.data?.items.length ? (
              <Empty
                title="No readings in this period"
                text="Try another date range, or connect your data source."
              />
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {[
                        'Timestamp',
                        'Voltage (V)',
                        'Current (A)',
                        'Power (W)',
                        'Energy (kWh)',
                        'Frequency (Hz)',
                        'Power factor',
                      ].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.data.items.map((r) => (
                      <tr key={r.id}>
                        <td className="timestamp-cell">
                          {date(r.timestamp)} <span>{time(r.timestamp, true)}</span>
                        </td>
                        <td>{number(r.voltage, 1)}</td>
                        <td>{number(r.current, 3)}</td>
                        <td className="green-text">{number(r.power, 1)}</td>
                        <td>{number(r.energy, 5)}</td>
                        <td>{number(r.frequency, 2)}</td>
                        <td>{number(r.power_factor, 3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="pagination">
              <span>
                Page {page} of {Math.max(1, Math.ceil((history.data?.total || 0) / 20))}
              </span>
              <div>
                <button
                  className="button small"
                  disabled={page <= 1 || history.loading}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft size={15} />
                  Previous
                </button>
                <button
                  className="button small"
                  disabled={page * 20 >= (history.data?.total || 0) || history.loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}
