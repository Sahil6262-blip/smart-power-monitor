import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Activity,
  ArrowUpRight,
  Bell,
  Bolt,
  ChartNoAxesCombined,
  ChevronLeft,
  CircleHelp,
  Cpu,
  FileChartColumn,
  History,
  LayoutDashboard,
  Menu,
  Radio,
  Settings2,
  Sparkles,
  X,
  Zap,
} from 'lucide-react'
import { useLive } from '../context/LiveContext'
import { date, time } from '../utils/format'
import { Badge } from './UI'

const navigation = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/live', label: 'Live monitoring', icon: Activity },
  { to: '/consumption', label: 'Consumption', icon: ChartNoAxesCombined },
  { to: '/insights', label: 'AI insights', icon: Sparkles },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/history', label: 'History', icon: History },
  { to: '/reports', label: 'Reports', icon: FileChartColumn },
  { to: '/device', label: 'Device status', icon: Cpu },
  { to: '/settings', label: 'Settings', icon: Settings2 },
]

export function ConnectionBadge() {
  const { status } = useLive()
  return (
    <Badge tone={status === 'live' ? 'green' : status === 'waiting' ? 'amber' : 'red'}>
      <span className={`status-dot ${status === 'live' ? 'pulse' : ''}`} />
      {status === 'live'
        ? 'Live'
        : status === 'waiting'
          ? 'Waiting for data'
          : 'Data connection lost'}
    </Badge>
  )
}

export function Shell() {
  const [collapsed, setCollapsed] = useState(false),
    [mobile, setMobile] = useState(false)
  const [now, setNow] = useState(new Date().toISOString())
  const { latest, device, status, storageError } = useLive()
  const location = useLocation()
  useEffect(() => {
    setMobile(false)
    window.scrollTo(0, 0)
  }, [location.pathname])
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toISOString()), 1000)
    return () => clearInterval(t)
  }, [])
  const selected = navigation.find((n) => n.to === location.pathname)
  return (
    <div className={`app-shell ${collapsed ? 'collapsed' : ''}`}>
      {mobile && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? 'mobile-open' : ''}`}>
        <NavLink className="brand" to="/" aria-label="Wattwise home">
          <span className="brand-mark">
            <Zap size={23} fill="currentColor" />
          </span>
          <span className="brand-text">
            wattwise<span className="brand-point">.</span>
          </span>
        </NavLink>
        <button
          className="mobile-close icon-button"
          onClick={() => setMobile(false)}
          aria-label="Close navigation"
        >
          <X size={19} />
        </button>
        <div className="workspace-card">
          <span className="workspace-icon">
            <Bolt size={18} />
          </span>
          <div>
            <strong>Main power supply</strong>
            <span>Single-phase monitoring</span>
          </div>
          <span className="workspace-dot" />
        </div>
        <div className="nav-section">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map((n, i) => (
            <div key={n.to}>
              {i === 7 && <div className="nav-section system-section">SYSTEM</div>}
              <NavLink
                to={n.to}
                end={n.to === '/'}
                title={n.label}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                <n.icon size={18} />
                <span>{n.label}</span>
                {n.to === '/alerts' && !!latest?.active_alert_count && (
                  <b className="nav-count">{latest.active_alert_count}</b>
                )}
                {n.to === '/insights' && <small className="soon">SOON</small>}
              </NavLink>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="source-card">
            <Radio size={17} />
            <div>
              <strong>
                {device?.source === 'hardware'
                  ? 'Hardware source'
                  : device?.source === 'demo'
                    ? 'Demo workspace'
                    : 'Connecting…'}
              </strong>
              <p>
                {device?.source === 'hardware'
                  ? 'ESP32 / PZEM input'
                  : device?.source === 'demo'
                    ? 'Simulated data. Real possibilities.'
                    : 'Checking data source'}
              </p>
            </div>
            <span className={`source-dot ${status}`} />
          </div>
          <button
            className="collapse-button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronLeft size={17} />
            <span>Collapse sidebar</span>
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-toggle"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span className="topbar-brand">Smart Power Monitor</span>
            <span className="breadcrumb-slash">/</span>
            <span className="breadcrumb-page">{selected?.label || 'Page not found'}</span>
          </div>
          <div className="topbar-right">
            <ConnectionBadge />
            <div className="topbar-clock">
              <span>
                {date(now)}, {new Date(now).getFullYear()}
              </span>
              <strong>{time(now, true)}</strong>
            </div>
            <NavLink
              to="/alerts"
              className="notification-button icon-button"
              aria-label="View notifications"
            >
              <Bell size={19} />
              {!!latest?.active_alert_count && <i />}
            </NavLink>
            <NavLink to="/settings" className="avatar" aria-label="Open settings">
              SP
            </NavLink>
          </div>
        </header>
        <main>
          {storageError && (
            <div className="error-state" role="alert">
              Storage is unavailable. The backend is retrying; displayed readings may be stale.
            </div>
          )}
          <Outlet />
        </main>
        <footer>
          <span>
            <Zap size={12} /> A little insight. A better energy future.
          </span>
          <span>
            Smart Power Monitoring System <span className="footer-divider">·</span> v1.0
          </span>
          <a href="http://127.0.0.1:8000/docs" target="_blank" rel="noreferrer">
            <CircleHelp size={13} /> API documentation <ArrowUpRight size={12} />
          </a>
        </footer>
      </div>
    </div>
  )
}
