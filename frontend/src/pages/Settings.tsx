import { useEffect, useState } from 'react'
import { BadgeIndianRupee, BellRing, Check, LoaderCircle, Save, ShieldCheck } from 'lucide-react'
import { useResource } from '../hooks/useResource'
import { api } from '../services/api'
import { useLive } from '../context/LiveContext'
import type { Settings as SettingsData } from '../types'
import { ErrorState, Loading, PageHeading, Panel } from '../components/UI'

const groups = [
  {
    title: 'Electricity & budget',
    description: 'Set your electricity rate and a monthly goal.',
    icon: BadgeIndianRupee,
    fields: [
      [
        'tariff',
        'Electricity tariff',
        '₹ / kWh',
        'Used to calculate estimated cost.',
        0,
        1000,
        0.01,
      ],
      [
        'monthly_energy_target',
        'Monthly energy target',
        'kWh',
        'An alert triggers when your usage reaches this target.',
        0.01,
        1000000,
        0.01,
      ],
    ],
  },
  {
    title: 'Electrical safety thresholds',
    description: 'Define the operating range for your power supply.',
    icon: ShieldCheck,
    fields: [
      ['min_voltage', 'Minimum voltage', 'V', 'Critical alert below this value.', 0, 1000, 0.1],
      ['max_voltage', 'Maximum voltage', 'V', 'Critical alert above this value.', 0.1, 1000, 0.1],
      [
        'max_current',
        'Maximum current',
        'A',
        'Critical alert above this load.',
        0.001,
        1000,
        0.001,
      ],
      [
        'max_power',
        'Maximum active power',
        'W',
        'Warning when this limit is exceeded.',
        0.1,
        1000000,
        0.1,
      ],
      [
        'min_power_factor',
        'Minimum power factor',
        '0–1',
        'Warning when power factor falls below this ratio.',
        0.01,
        1,
        0.01,
      ],
    ],
  },
  {
    title: 'Event detection',
    description: 'Fine-tune how the system identifies changes.',
    icon: BellRing,
    fields: [
      [
        'sudden_power_increase',
        'Sudden power increase',
        'W',
        'Compared with the previous reading.',
        0.1,
        1000000,
        0.1,
      ],
      [
        'connection_timeout_seconds',
        'Connection timeout',
        'seconds',
        'Delay before the backend records a connection alert.',
        5,
        120,
        1,
      ],
    ],
  },
] as const

export default function Settings() {
  const { mode } = useLive()
  const result = useResource<SettingsData>('/settings')
  const [form, setForm] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('')
  useEffect(() => {
    if (result.data)
      setForm(Object.fromEntries(Object.entries(result.data).map(([k, v]) => [k, String(v)])))
  }, [result.data])
  const dirty =
    !!result.data &&
    Object.entries(result.data).some(([k, v]) => Number(form[k]) !== v || form[k] === '')
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'offline-device') return
    setError('')
    setMessage('')
    if (Number(form.min_voltage) >= Number(form.max_voltage)) {
      setError('Minimum voltage must be less than maximum voltage.')
      return
    }
    setBusy(true)
    try {
      await api<SettingsData>('/settings', {
        method: 'PUT',
        body: JSON.stringify(
          Object.fromEntries(Object.entries(form).map(([k, v]) => [k, Number(v)])),
        ),
      })
      setMessage('Settings saved. New thresholds apply to the next reading.')
      result.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="page-enter">
      <PageHeading title="Settings" />
      {result.error && <ErrorState message={result.error} retry={result.refresh} />}{' '}
      {result.loading && !result.data ? (
        <Loading />
      ) : (
        <form onSubmit={save} className="settings-form">
          {groups.map((group) => (
            <Panel className="settings-section" key={group.title}>
              <div className="settings-section-heading">
                <span className="settings-icon">
                  <group.icon size={22} />
                </span>
                <div>
                  <h2>{group.title}</h2>
                  <p>{group.description}</p>
                </div>
              </div>
              <div className="settings-fields">
                {group.fields.map(([key, label, unit, hint, min, max, step]) => (
                  <label key={key} className="field">
                    <span>{label}</span>
                    <div className="input-with-unit">
                      <input
                        aria-label={label}
                        required
                        disabled={mode === 'offline-device'}
                        type="number"
                        min={min}
                        max={max}
                        step={step}
                        value={form[key] ?? ''}
                        onChange={(e) => {
                          setForm((f) => ({ ...f, [key]: e.target.value }))
                          setMessage('')
                        }}
                      />
                      <span>{unit}</span>
                    </div>
                    <small>{hint}</small>
                  </label>
                ))}
              </div>
            </Panel>
          ))}
          {error && <ErrorState message={error} />}{' '}
          {message && (
            <div className="success-message" role="status">
              <Check size={18} />
              {message}
            </div>
          )}
          <div className="settings-save">
            <span>
              {mode === 'offline-device'
                ? 'Offline thresholds are read-only. Reconnect to cloud to save changes.'
                : dirty
                  ? 'You have unsaved changes.'
                  : 'Settings are stored in your database.'}
            </span>
            <button
              type="submit"
              className="button primary"
              disabled={busy || !dirty || mode === 'offline-device'}
            >
              {busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}Save changes
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
