/*
 * Entry point. The screen is served by the ERP's own `screen` action and calls the
 * ERP through it, carrying the key from the link Demo Builder opened.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './components/App'
import { takeScreenKey } from './key'

createRoot(document.getElementById('root')).render(<App screenKey={takeScreenKey()} />)
