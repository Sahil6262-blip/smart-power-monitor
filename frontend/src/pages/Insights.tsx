import { useMemo } from 'react'
import { ArrowRight, ChartNoAxesCombined, Clock3, IndianRupee, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useLive } from '../context/LiveContext'
import { Badge, PageHeading, Panel } from '../components/UI'
import { money, number } from '../utils/format'
import { consumptionForecast } from '../services/forecast'
import './forecast.css'

export default function Insights() {
  const {
    latest,
    points,
    session,
    mode,
    status,
    settings,
    settingsOrigin,
    device,
    exportTimezone,
  } = useLive()
  const zone = device?.timezone || exportTimezone
  const history = mode === 'cloud' ? points : session.points
  const { forecast, reason } = useMemo(
    () =>
      consumptionForecast({
        readings: history,
        latest,
        mode,
        live: status === 'live',
        tariff: settings.tariff,
        zone,
        now: new Date(),
      }),
    [history, latest, mode, status, settings.tariff, zone],
  )
  const cards = [
    {
      title: 'Next hour · consumption',
      value: forecast ? `${number(forecast.nextHourKwh, 3)} kWh` : '—',
      note: 'At the recent circuit load',
      icon: Zap,
    },
    {
      title: 'Next hour · cost',
      value: forecast ? money(forecast.nextHourCost) : '—',
      note: 'Using your flat tariff',
      icon: IndianRupee,
    },
    {
      title: 'Today by midnight · consumption',
      value: forecast ? `${number(forecast.projectedTodayKwh, 3)} kWh` : '—',
      note: 'Recorded energy + projected remainder',
      icon: ChartNoAxesCombined,
    },
    {
      title: 'Today by midnight · cost',
      value: forecast ? money(forecast.projectedTodayCost) : '—',
      note: 'Energy estimate × tariff',
      icon: IndianRupee,
    },
  ]
  const capturedShare = forecast?.projectedTodayKwh
    ? Math.min(100, (forecast.recordedTodayKwh / forecast.projectedTodayKwh) * 100)
    : 0
  return (
    <div className="page-enter forecast-page">
      <PageHeading
        title="Predictions"
        description="Short-term consumption and cost estimates for your circuit."
        action={<Badge>Calculated from readings</Badge>}
      />
      <Panel className="forecast-intro">
        <span className="forecast-intro-icon" aria-hidden="true">
          <ChartNoAxesCombined size={27} />
        </span>
        <div>
          <span className="forecast-kicker">CIRCUIT OUTLOOK</span>
          <h2>See where today's energy is heading.</h2>
          <p>
            A recent power average estimates the next hour and the rest of today. The cost
            uses your saved electricity tariff.
          </p>
        </div>
        <span className="forecast-source">
          <span className={`status-dot ${forecast ? 'pulse' : ''}`} />
          {mode === 'offline-device'
            ? 'Bluetooth meter'
            : latest?.source === 'demo'
              ? 'Demo readings'
              : 'Cloud meter'}
        </span>
      </Panel>
      <div className="forecast-grid">
        {cards.map(({ title, value, note, icon: Icon }) => (
          <Panel key={title} className="forecast-card">
            <div className="forecast-card-top">
              <h2>{title}</h2>
              <Icon size={19} aria-hidden="true" />
            </div>
            <strong>{value}</strong>
            <p>{forecast ? note : 'Waiting for a reliable estimate'}</p>
          </Panel>
        ))}
      </div>
      <Panel className="forecast-detail">
        <div className="panel-title">
          <div>
            <h2>How this estimate is built</h2>
            <p>Simple projection from observed power, with no trained model.</p>
          </div>
          <Clock3 size={20} aria-hidden="true" />
        </div>
        {forecast ? (
          <>
            <div className="forecast-breakdown">
              <div>
                <span>
                  {mode === 'offline-device' ? 'Captured today via Bluetooth' : 'Recorded today'}
                </span>
                <strong>{number(forecast.recordedTodayKwh, 3)} kWh</strong>
              </div>
              <div>
                <span>Recent average power</span>
                <strong>{number(forecast.averagePowerW, 1)} W</strong>
              </div>
              <div>
                <span>Observed window</span>
                <strong>{number(forecast.observedMinutes, 1)} min</strong>
              </div>
              <div>
                <span>Tariff</span>
                <strong>{money(settings.tariff)} / kWh</strong>
              </div>
            </div>
            <div
              className="forecast-bar"
              role="img"
              aria-label="Recorded versus projected energy by midnight"
            >
              <span style={{ width: `${capturedShare}%` }} />
            </div>
            <div className="forecast-legend">
              <span>
                <i className="forecast-legend-recorded" /> Recorded
              </span>
              <span>
                <i className="forecast-legend-future" /> Projected remaining
              </span>
            </div>
            <p className="forecast-explanation">
              Assumes the recent average load continues for the next hour and until midnight in{' '}
              {zone}.
              {mode === 'offline-device' &&
                ' The daily total includes only energy captured by this browser; gaps and earlier usage may be missing.'}
              {settingsOrigin === 'defaults' &&
                ' Cost uses the default tariff until your saved setting loads.'}{' '}
              Fixed charges and taxes are excluded.
            </p>
          </>
        ) : (
          <div className="forecast-wait" role="status">
            <Clock3 size={21} aria-hidden="true" />
            <div>
              <strong>Forecast pending</strong>
              <p>{reason}</p>
            </div>
          </div>
        )}
      </Panel>
      <Link className="forecast-link" to="/consumption">
        Explore recorded consumption <ArrowRight size={16} />
      </Link>
    </div>
  )
}
