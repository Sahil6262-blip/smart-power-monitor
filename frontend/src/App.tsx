import { lazy, Suspense } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { LiveProvider } from './context/LiveContext'
import { DevicesProvider } from './context/DevicesContext'
import { Shell } from './components/Shell'
import { Empty, Loading, Panel } from './components/UI'
import Dashboard from './pages/Dashboard'

const LiveMonitoring = lazy(() => import('./pages/LiveMonitoring'))
const Consumption = lazy(() => import('./pages/Consumption'))
const Alerts = lazy(() => import('./pages/Alerts'))
const History = lazy(() => import('./pages/History'))
const Reports = lazy(() => import('./pages/Reports'))
const Settings = lazy(() => import('./pages/Settings'))
const DeviceStatus = lazy(() => import('./pages/DeviceStatus'))
const Devices = lazy(() => import('./pages/Devices'))
const Insights = lazy(() => import('./pages/Insights'))

export default function App() {
  return (
    <BrowserRouter>
      <LiveProvider>
        <DevicesProvider>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route element={<Shell />}>
                <Route index element={<Dashboard />} />
                <Route path="live" element={<LiveMonitoring />} />
                <Route path="consumption" element={<Consumption />} />
                <Route path="alerts" element={<Alerts />} />
                <Route path="history" element={<History />} />
                <Route path="reports" element={<Reports />} />
                <Route path="settings" element={<Settings />} />
                <Route path="device" element={<DeviceStatus />} />
                <Route path="devices" element={<Devices />} />
                <Route path="insights" element={<Insights />} />
                <Route
                  path="*"
                  element={
                    <Panel>
                      <Empty
                        title="This page is off the grid"
                        text="Let’s get you back to your energy overview."
                      />
                      <Link className="button" to="/">
                        Back to dashboard
                      </Link>
                    </Panel>
                  }
                />
              </Route>
            </Routes>
          </Suspense>
        </DevicesProvider>
      </LiveProvider>
    </BrowserRouter>
  )
}
