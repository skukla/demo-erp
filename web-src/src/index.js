/*
 * Entry point. Inside the Experience Cloud shell the user's IMS token arrives on
 * the runtime's ready event and every action call carries it. Opened as a bare
 * static URL there is no shell and no token, so the screen says where to open it.
 * Bootstrap shape follows Adobe's exc-react web-assets template.
 */
import 'core-js/stable'
import 'regenerator-runtime/runtime'
import React from 'react'
import { createRoot } from 'react-dom/client'
import Runtime, { init } from '@adobe/exc-app'
import App from './components/App'

window.React = React
const root = createRoot(document.getElementById('root'))

try {
  require('./exc-runtime')
  init(bootstrapInExcShell)
} catch (e) {
  root.render(<App runtime={{ on: () => {} }} ims={null} />)
}

function bootstrapInExcShell () {
  const runtime = Runtime()
  runtime.on('ready', ({ imsOrg, imsToken, imsProfile }) => {
    runtime.done()
    root.render(<App runtime={runtime} ims={{ org: imsOrg, token: imsToken, profile: imsProfile }} />)
  })
  runtime.on('configuration', ({ imsOrg, imsToken }) => {
    root.render(<App runtime={runtime} ims={{ org: imsOrg, token: imsToken }} />)
  })
  runtime.solution = { icon: 'AdobeExperienceCloud', title: 'ERP', shortTitle: 'ERP' }
  runtime.title = 'ERP'
}
