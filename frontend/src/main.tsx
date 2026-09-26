import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/base.css'
import './styles/shell.css'
import './styles/controls.css'
import './styles/forecast.css'
import './styles/sidebar.css'
import './styles/village.css'
import './styles/evidence.css'
import './styles/about.css'
import './styles/print.css'
import App from './App'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element in index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
