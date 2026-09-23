/* The ERP's own App, rendered against stand-in records. See fakeApi.js. */
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from '../screen/src/components/App'
import { fakeApi } from './fakeApi'
import '../screen/src/design/tokens.css'
import '../screen/src/design/spectrum-bridge.css'
import '../screen/src/design/app.css'

createRoot(document.getElementById('root')).render(<App api={fakeApi} />)
