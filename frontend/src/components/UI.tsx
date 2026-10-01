import { useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowDownToLine, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react'
import { API } from '../services/api'
import type { Reading } from '../types'
import { downloadReadingCsv, parseReadingCsv } from '../services/readingCsv'
import { offlineResource } from '../services/offlineResources'
import { useLive } from '../context/LiveContext'

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{children}</section>
}
export function PageHeading({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="heading-actions">{action}</div>
    </div>
  )
}
export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={20} /> Loading your energy data…
    </div>
  )
}
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <TriangleAlert size={18} />
      <span>{message}</span>
      {retry && (
        <button className="button small" onClick={retry}>
          <RefreshCw size={14} />
          Retry
        </button>
      )}
    </div>
  )
}
export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <RefreshCw size={23} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  )
}
export function ExportButton({ path, label = 'Export CSV' }: { path: string; label?: string }) {
  const { mode, session, settings, device, exportTimezone } = useLive()
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  return (
    <div className="export-wrap">
      <button
        className="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            const query = new URL(path, location.origin).searchParams
            let readings: Reading[]
            if (mode === 'offline-device') {
              query.set('page', '1')
              query.set('page_size', '10000')
              readings = (
                offlineResource(`/history?${query}`, session, settings, device) as {
                  items: Reading[]
                }
              ).items
            } else {
              const response = await fetch(`${API}/api/history/export?${query}`, {
                signal: AbortSignal.timeout(60000),
              })
              if (!response.ok) throw new Error('Export failed. Please try again.')
              readings = parseReadingCsv(await response.text())
            }
            downloadReadingCsv(readings, exportTimezone)
          } catch (e) {
            setError((e as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? <LoaderCircle size={15} className="spin" /> : <ArrowDownToLine size={15} />} {label}
      </button>
      {error && (
        <small className="danger-text" role="alert">
          {error}
        </small>
      )}
    </div>
  )
}
export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T
  onChange: (v: T) => void
  items: { value: T; label: string }[]
}) {
  return (
    <div className="tabs" role="group">
      {items.map((item) => (
        <button
          key={item.value}
          aria-pressed={value === item.value}
          className={value === item.value ? 'selected' : ''}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
