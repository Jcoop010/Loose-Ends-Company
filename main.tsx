import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { ErrorBoundary } from './components/ErrorBoundary'

// Loose Ends V4 production entrypoint — keep the React application as the source of truth.
if (typeof document !== 'undefined') {
  document.documentElement.dataset.looseEndsVersion = 'V4'
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </React.StrictMode>,
)
