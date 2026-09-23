/*
 * The ERP's screen: one Spectrum app with a side rail. Every page loads through
 * the same `api` and shows the same error banner; the key from Demo Builder's link
 * is the only credential, so opened without one it says where to go instead.
 */
import React, { useEffect, useState, useCallback } from 'react'
import { Provider, defaultTheme, ActionGroup, Item, InlineAlert, Heading, Content, ToastContainer } from '@adobe/react-spectrum'
import { makeApi } from '../api'
import Dashboard from './Dashboard'
import Products from './Products'
import Partners from './Partners'
import Orders from './Orders'
import Pricing from './Pricing'
import Settings from './Settings'
import Events from './Events'

const PAGES = [
  { key: 'dashboard', label: 'Dashboard', Component: Dashboard },
  { key: 'products', label: 'Products', Component: Products },
  { key: 'partners', label: 'Customers', Component: Partners },
  { key: 'orders', label: 'Sales orders', Component: Orders },
  { key: 'pricing', label: 'Pricing', Component: Pricing },
  { key: 'events', label: 'Event journal', Component: Events },
  { key: 'settings', label: 'Settings', Component: Settings }
]

/**
 * @param {object} props `screenKey` from Demo Builder's link, and `api` — an override
 *   the local preview hands in so the whole screen can be looked at without a deployed
 *   action, a key, or any records. Nothing in production passes it.
 */
export default function App ({ screenKey, api: given }) {
  const [page, setPage] = useState('dashboard')
  const [health, setHealth] = useState(null)
  const [error, setError] = useState(null)
  const api = React.useMemo(() => given || makeApi(screenKey), [given, screenKey])
  const ready = Boolean(screenKey || given)

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await api.health())
      setError(null)
    } catch (e) {
      setError(e)
    }
  }, [api])

  useEffect(() => { if (ready) refreshHealth() }, [ready, refreshHealth])

  // While a sync runs, keep reading health: the Dashboard's counters are the
  // ERP's contents, so they should climb as the integration imports rather than
  // jump when the SC next opens the page. Re-armed after each read (health is a
  // dependency), so it stops by itself when the sync ends.
  const syncing = Boolean(health && health.sync && (health.sync.state === 'requested' || health.sync.state === 'running'))
  useEffect(() => {
    if (!ready || !syncing) return undefined
    const id = setTimeout(refreshHealth, 2000)
    return () => clearTimeout(id)
  }, [ready, syncing, refreshHealth, health])

  const active = PAGES.find((p) => p.key === page) || PAGES[0]
  return (
    <Provider theme={defaultTheme} colorScheme='light' height='100vh'>
      {/* Plain elements, not Spectrum's Grid and View: the rail moves to the top on a
          narrow screen, and that is a media rule rather than a token (theme.css). */}
      <div className='erp-app'>
        <div className='erp-rail'>
          <p className='erp-rail-name'>{health ? health.displayName : 'ERP'}</p>
          <ActionGroup orientation='vertical' isQuiet selectionMode='single' selectedKeys={[page]}
            onSelectionChange={(keys) => setPage([...keys][0] || 'dashboard')} width='100%'>
            {PAGES.map((p) => <Item key={p.key}>{p.label}</Item>)}
          </ActionGroup>
        </div>
        <div className='erp-content'>
          {!ready && (
            <InlineAlert variant='info'>
              <Heading>Open the ERP from Demo Builder</Heading>
              <Content>This address needs the key in the link Demo Builder opens. On the project's Integrations page, choose Open ERP.</Content>
            </InlineAlert>
          )}
          {ready && error && (
            <InlineAlert variant='negative' marginBottom='size-300'>
              <Heading>The ERP did not answer</Heading>
              <Content>{error.message}</Content>
            </InlineAlert>
          )}
          {ready && <active.Component key={active.key} api={api} health={health} onChanged={refreshHealth} onNavigate={setPage} />}
        </div>
      </div>
      <ToastContainer placement='top' />
    </Provider>
  )
}
