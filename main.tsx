import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { ErrorBoundary } from './components/ErrorBoundary'

// V4 production marker: keep the real React app as the single source of truth.
if (typeof document !== 'undefined') {
  document.documentElement.dataset.looseEndsVersion = 'V4'
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </React.StrictMode>,
)
