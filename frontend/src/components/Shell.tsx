import { Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  ArrowUpRight,
  Bell,
  Bolt,
  ChevronDown,
  ChevronLeft,
  CircleHelp,
  Menu,
  Radio,
  X,
  Zap,
} from 'lucide-react'
import { useLive } from '../context/LiveContext'
import { date, time } from '../utils/format'
import { Badge, Loading } from './UI'
import { CommandMenu } from './CommandMenu'
import { navigation } from './navigation'
import { API } from '../services/api'

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
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('wattwise-sidebar') === 'collapsed'
    } catch {
      return false
    }
  })
  const [mobile, setMobile] = useState(false)
  const [now, setNow] = useState(new Date().toISOString())
  const { latest, device, status, storageError } = useLive()
  const location = useLocation()
  const sidebar = useRef<HTMLElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const activeCount = latest?.active_alert_count ?? device?.active_alerts ?? 0
  useEffect(() => {
    setMobile(false)
    window.scrollTo(0, 0)
  }, [location.pathname])
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem('wattwise-sidebar', collapsed ? 'collapsed' : 'expanded')
    } catch {
      /* Navigation still works when storage is disabled. */
    }
  }, [collapsed])
  useEffect(() => {
    if (!mobile) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const links = () =>
      [...(sidebar.current?.querySelectorAll<HTMLElement>('a, button') ?? [])].filter(
        (el) => el.getClientRects().length > 0,
      )
    links()[0]?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobile(false)
        menuButton.current?.focus()
      }
      if (event.key === 'Tab') {
        const elements = links(),
          first = elements[0],
          last = elements.at(-1)
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    document.addEventListener('keydown', key)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', key)
    }
  }, [mobile])
  const selected = navigation.find((item) => item.to === location.pathname)
  const PageIcon = selected?.icon || Zap
  const docsUrl = API ? `${API}/docs` : 'http://127.0.0.1:8000/docs'

  return (
    <div className={`app-shell ${collapsed ? 'collapsed' : ''}`}>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      {mobile && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation overlay"
          onClick={() => {
            setMobile(false)
            menuButton.current?.focus()
          }}
        />
      )}
      <aside
        ref={sidebar}
        className={`sidebar ${mobile ? 'mobile-open' : ''}`}
        aria-label="Workspace navigation"
      >
        <NavLink className="brand" to="/" aria-label="Wattwise home">
          <span className="brand-mark">
            <Zap size={23} fill="currentColor" />
          </span>
          <span className="brand-text">
            wattwise<small>ENERGY INTELLIGENCE</small>
          </span>
        </NavLink>
        <button
          className="mobile-close icon-button"
          onClick={() => {
            setMobile(false)
            menuButton.current?.focus()
          }}
          aria-label="Close navigation"
        >
          <X size={20} />
        </button>
        <NavLink to="/device" className="workspace-card">
          <span className="workspace-icon">
            <Bolt size={18} />
          </span>
          <div>
            <strong>Main power supply</strong>
            <span>Your energy workspace</span>
          </div>
          <ChevronDown size={14} />
        </NavLink>
        <div className="nav-section">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map((item, index) => (
            <div key={item.to}>
              {index === 7 && <div className="nav-section system-section">MANAGE</div>}
              <NavLink
                to={item.to}
                end={item.to === '/'}
                title={item.label}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
                {item.to === '/alerts' && activeCount > 0 && (
                  <b className="nav-count">{activeCount}</b>
                )}
                {item.to === '/insights' && <small className="soon">LAB</small>}
              </NavLink>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="source-card">
            <span className="source-card-icon">
              <Radio size={17} />
            </span>
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
                    ? 'Simulated readings'
                    : 'Checking your connection'}
              </p>
            </div>
            <span className={`source-dot ${status}`} />
          </div>
          <button
            className="collapse-button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronLeft size={16} />
            <span>Collapse sidebar</span>
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              ref={menuButton}
              className="icon-button mobile-toggle"
              aria-label="Open navigation"
              aria-expanded={mobile}
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <PageIcon size={17} className="breadcrumb-icon" />
            <span className="topbar-brand">Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <span className="breadcrumb-page">{selected?.label || 'Page not found'}</span>
          </div>
          <div className="topbar-right">
            <CommandMenu />
            <span className="topbar-separator" />
            <ConnectionBadge />
            <NavLink
              to="/alerts"
              className="notification-button icon-button"
              aria-label="View notifications"
            >
              <Bell size={18} />
              {activeCount > 0 && <i />}
            </NavLink>
            <NavLink to="/settings" className="avatar" aria-label="Open settings">
              SP
            </NavLink>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <div className="workspace-meta">
            <span>SMART POWER MONITORING</span>
            <span>
              {date(now)} <span>·</span> {time(now, true)}{' '}
              <span className="clock-zone">{device?.timezone || 'Asia/Kolkata'}</span>
            </span>
          </div>
          {storageError && (
            <div className="error-state" role="alert">
              Storage is unavailable. The backend is retrying; displayed readings may be stale.
            </div>
          )}
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </main>
        <footer>
          <span>
            <span className={`status-dot ${status === 'live' ? 'green-text' : 'amber-text'}`} />
            {status === 'live' ? 'Connected to your energy' : 'Ready for your next reading'}
          </span>
          <span>
            Wattwise <span className="footer-divider">/</span> Designed for a brighter tomorrow.
          </span>
          <a href={docsUrl} target="_blank" rel="noreferrer">
            <CircleHelp size={13} /> API documentation <ArrowUpRight size={12} />
          </a>
        </footer>
      </div>
    </div>
  )
}
