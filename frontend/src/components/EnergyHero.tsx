import { ArrowUpRight, Cable, Cpu, Radio, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useLive } from '../context/LiveContext'
import { money, number } from '../utils/format'

export function EnergyHero() {
  const { latest, status, device } = useLive()
  return (
    <section className={`energy-hero hero-${status}`} aria-label="Energy control center">
      <div className="hero-copy">
        <div className="hero-overline">
          <span /> THE POWER OF KNOWING
        </div>
        <h2>
          Every watt.
          <br />
          <span>In your hands.</span>
        </h2>
        <p>A connected view of your energy, from the first reading to the bigger picture.</p>
        <Link to="/live" className="hero-link">
          Explore live monitoring <ArrowUpRight size={16} />
        </Link>
      </div>
      <div className="energy-orbit" aria-hidden="true">
        <div className="orbit-grid" />
        <div className="orbit-ring outer" />
        <div className="orbit-ring middle" />
        <div className="orbit-ring inner" />
        <div className="orbit-axis horizontal" />
        <div className="orbit-axis vertical" />
        <div className="orbit-satellite satellite-source">
          <Cable size={17} />
        </div>
        <div className="orbit-satellite satellite-meter">
          <Cpu size={17} />
        </div>
        <div className="orbit-satellite satellite-signal">
          <Radio size={17} />
        </div>
        <div className="orbit-core">
          <Zap size={22} />
          <strong>
            {number(latest?.power, 0)}
            <small>W</small>
          </strong>
          <span>{status === 'live' ? 'LIVE DEMAND' : 'AWAITING SIGNAL'}</span>
        </div>
        <div className="orbit-caption">
          <span className={`status-dot ${status === 'live' ? 'pulse' : ''}`} />
          {device?.source === 'demo' ? 'SIMULATED SOURCE' : 'ESP32 / PZEM'}
        </div>
      </div>
      <div className="hero-totals">
        <div className="hero-totals-heading">
          <span>TODAY SO FAR</span>
          <span className="hero-date-tag">kWh</span>
        </div>
        <strong className="hero-energy">{number(latest?.today.energy_kwh, 2)}</strong>
        <span className="hero-energy-caption">Energy consumed</span>
        <div className="hero-cost">
          <span>Estimated cost</span>
          <strong>{money(latest?.today.estimated_cost)}</strong>
        </div>
        <div className="hero-status">
          <span className="status-dot" />
          {status === 'live' ? 'Receiving real-time measurements' : 'Ready when your device is'}
        </div>
      </div>
    </section>
  )
}
