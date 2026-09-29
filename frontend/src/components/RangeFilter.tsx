import { CalendarDays } from 'lucide-react'

export interface DateRange {
  range: string
  start: string
  end: string
}
export const defaultRange: DateRange = { range: 'today', start: '', end: '' }
export function rangeQuery(value: DateRange) {
  const params = new URLSearchParams({ range: value.range })
  if (value.range === 'custom') {
    if (!value.start || !value.end || new Date(value.start) >= new Date(value.end)) return null
    params.set('start', new Date(value.start).toISOString())
    params.set('end', new Date(value.end).toISOString())
  }
  return params.toString()
}
export function RangeFilter({
  value,
  onChange,
}: {
  value: DateRange
  onChange: (value: DateRange) => void
}) {
  return (
    <div className="range-filter">
      <CalendarDays size={16} />
      <select
        aria-label="Date range"
        value={value.range}
        onChange={(e) => onChange({ ...value, range: e.target.value })}
      >
        <option value="today">Today</option>
        <option value="yesterday">Yesterday</option>
        <option value="week">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="custom">Custom range</option>
      </select>
      {value.range === 'custom' && (
        <>
          <label>
            From{' '}
            <input
              aria-label="Range start"
              type="datetime-local"
              value={value.start}
              onChange={(e) => onChange({ ...value, start: e.target.value })}
            />
          </label>
          <label>
            To{' '}
            <input
              aria-label="Range end"
              type="datetime-local"
              value={value.end}
              onChange={(e) => onChange({ ...value, end: e.target.value })}
            />
          </label>
          <small>Custom dates use your browser’s local timezone. End is exclusive.</small>
        </>
      )}
    </div>
  )
}
