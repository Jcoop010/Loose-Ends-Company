import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { AppRoot } from './AppRoot'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root mount container #root was not found in document.')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AppRoot />
  </React.StrictMode>,
)
