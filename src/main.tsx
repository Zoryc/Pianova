import './styles/theme.css'
import './styles/app.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { APP_NAME } from './app/appInfo'

document.title = APP_NAME

const container = document.getElementById('root')
if (!container) throw new Error('index.html has no element with id "root" to draw the app in.')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
