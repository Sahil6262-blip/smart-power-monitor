import { ArrowUpRight, Cable, Clock3, Cpu, PlugZap, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useLive } from '../context/LiveContext'
import { money, number, time } from '../utils/format'

export function EnergyHero() {
  const { latest, status, device } = useLive()
  const isLive = status === 'live'
  return (
    <section className="energy-overview-grid" aria-label="Energy at a glance">
      <div className={`energy-flow-panel flow-${status}`}>
        <div className="flow-heading">
          <div>
            <span className="eyebrow">THE BIG PICTURE</span>
            <h2>Your energy, connected.</h2>
          </div>
          <span className="flow-source">
            <span className="status-dot" />
            {device?.source === 'demo'
              ? 'Demo source'
              : device?.source === 'hardware'
                ? 'Single-phase AC'
                : 'Connecting'}
          </span>
        </div>
        <div className="energy-flow-diagram">
          <svg
            className="flow-wires"
            viewBox="0 0 600 160"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              className="wire-base"
              d="M 75 80 H 180 Q 205 80 205 105 V 123 Q 205 137 225 137 H 255 M 345 137 H 375 Q 395 137 395 123 V 105 Q 395 80 420 80 H 525"
            />
            <path
              className="wire-pulse"
              d="M 75 80 H 180 Q 205 80 205 105 V 123 Q 205 137 225 137 H 255 M 345 137 H 375 Q 395 137 395 123 V 105 Q 395 80 420 80 H 525"
            />
          </svg>
          <div className="flow-endpoint">
            <div className="flow-node">
              <Cable size={23} />
            </div>
            <strong>Main supply</strong>
            <span>{latest ? `${number(latest.voltage, 1)} V` : 'Awaiting voltage'}</span>
          </div>
          <div className="flow-center">
            <div className="flow-halo" aria-hidden="true" />
            <div className="flow-meter">
              <Zap size={18} />
              <span className="flow-meter-label">ACTIVE POWER</span>
              <strong>
                {number(latest?.power, 1)}
                <small>W</small>
              </strong>
              <span className={`flow-state ${isLive ? 'live' : ''}`}>
                <span className="status-dot" />
                {isLive ? 'Live demand' : latest ? 'Last known reading' : 'Awaiting signal'}
              </span>
            </div>
          </div>
          <div className="flow-endpoint">
            <div className="flow-node">
              <PlugZap size={23} />
            </div>
            <strong>Connected load</strong>
            <span>{latest ? `${number(latest.current, 3)} A` : 'Awaiting current'}</span>
          </div>
        </div>
        <div className="flow-footer">
          <span>
            <Cpu size={13} />
            {device?.source === 'demo' ? 'Software simulator' : 'ESP32 / PZEM meter'}
          </span>
          <Link to="/live">
            Explore live monitoring <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>
      <div className="daily-highlight">
        <div className="daily-heading">
          <span>TODAY’S ENERGY</span>
          <span className="daily-symbol">
            <Zap size={19} />
          </span>
        </div>
        <div className="daily-energy-value">
          {number(latest?.today.energy_kwh, 2)}
          <span>kWh</span>
        </div>
        <p>Every reading adds to the bigger picture.</p>
        <div className="daily-cost">
          <span>Estimated cost</span>
          <strong>{money(latest?.today.estimated_cost)}</strong>
        </div>
        <div className="daily-footer">
          <span>
            <Clock3 size={12} /> Peak at {time(latest?.today.peak_time)}
          </span>
          <Link to="/consumption" aria-label="Explore consumption">
            <ArrowUpRight size={18} />
          </Link>
        </div>
      </div>
    </section>
  )
}
