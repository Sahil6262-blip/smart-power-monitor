import { Component, StrictMode } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/manrope'
import './design.css'
import './offline.css'

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }
  render() {
    return this.state.failed ? (
      <div className="fatal-error">
        <h1>Something interrupted the dashboard.</h1>
        <p>Your readings are still stored by the backend. Reload to reconnect.</p>
        <button className="button primary" onClick={() => location.reload()}>
          Reload dashboard
        </button>
      </div>
    ) : (
      this.props.children
    )
  }
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
