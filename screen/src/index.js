/*
 * Entry point. The screen is served by the ERP's own `screen` action and calls the
 * ERP through it, carrying the key from the link Demo Builder opened.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './components/App'
import { takeScreenKey } from './key'
// Last, so its rules land after Spectrum's own in the bundled stylesheet.
import './theme.css'

createRoot(document.getElementById('root')).render(<App screenKey={takeScreenKey()} />)
