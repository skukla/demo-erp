/*
 * The ERP's screen: one Spectrum app with a side rail. Every page loads through
 * the same `api` and shows the same error banner; the key from Demo Builder's link
 * is the only credential, so opened without one it says where to go instead.
 */
import React, { useEffect, useState, useCallback } from 'react'
import { Provider, defaultTheme, ActionButton, InlineAlert, Heading, Content, ToastContainer } from '@adobe/react-spectrum'
import { makeApi } from '../api'
import { pageFromHash } from '../pageRoute'
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
  { key: 'orders', label: 'Sales Orders', Component: Orders },
  { key: 'pricing', label: 'Pricing Rules', Component: Pricing },
  { key: 'events', label: 'Event Journal', Component: Events },
  { key: 'settings', label: 'Settings', Component: Settings }
]

/**
 * @param {object} props `screenKey` from Demo Builder's link, and `api` — an override
 *   the local preview hands in so the whole screen can be looked at without a deployed
 *   action, a key, or any records. Nothing in production passes it.
 */
const PAGE_KEYS = PAGES.map((p) => p.key)
const DEFAULT_PAGE = 'dashboard'

export default function App ({ screenKey, api: given }) {
  // The open area comes from the address bar, so reloading the browser stays where it
  // was. Before this it lived only in memory and every reload landed on the Dashboard.
  const [page, setPage] = useState(() => pageFromHash(window.location.hash, PAGE_KEYS) || DEFAULT_PAGE)
  // Bumped on every rail click and carried in the active page's key, so choosing an
  // area re-mounts it and it reads its records again — including when the area chosen
  // is the one already open, which is what someone clicking it again is asking for.
  const [visit, setVisit] = useState(0)
  const [reloading, setReloading] = useState(false)
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

  /* Back, Forward, and a hash someone typed. */
  useEffect(() => {
    const follow = () => setPage(pageFromHash(window.location.hash, PAGE_KEYS) || DEFAULT_PAGE)
    window.addEventListener('hashchange', follow)
    return () => window.removeEventListener('hashchange', follow)
  }, [])

  /* Open an area and put it in the address bar. Writing the hash raises hashchange,
     which sets the state — so this only writes when it would actually differ, or the
     two would chase each other. */
  const openPage = useCallback((key) => {
    setPage(key)
    if (pageFromHash(window.location.hash, PAGE_KEYS) !== key) {
      window.location.hash = key
    }
  }, [])

  /* A rail click, whichever item it lands on. The counter re-mounts the page — every
     screen reads its own records on mount and shows its spinner while it does — and the
     health read is for the Dashboard, whose numbers are held here rather than by it. */
  const revisit = useCallback(async () => {
    setVisit((n) => n + 1)
    setReloading(true)
    await refreshHealth()
    setReloading(false)
  }, [refreshHealth])

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
        {/* Buttons, not a single-selection ActionGroup. Two reasons, both found by
            trying it the other way:
            - choosing the area already open raises no SELECTION change, so there was
              nothing to hang a reload on, and a click listener on this div never fires
              because react-aria swallows the click on its own buttons;
            - worse, a single-selection group DESELECTS the item you click when it is
              already selected, so clicking the open area sent the user to the Dashboard.
            `aria-current="page"` is also what a navigation list should say; aria-checked
            described these as radio buttons, which they are not. */}
        <div className='erp-rail'>
          <p className='erp-rail-name'>{health ? health.displayName : 'ERP'}</p>
          <nav className='erp-rail-nav' aria-label='Areas'>
            {PAGES.map((p) => (
              <ActionButton
                key={p.key}
                isQuiet
                aria-current={p.key === page ? 'page' : undefined}
                onPress={() => { openPage(p.key); revisit() }}
              >
                {p.label}
              </ActionButton>
            ))}
          </nav>
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
          {ready && (
            <active.Component
              key={`${active.key}:${visit}`}
              api={api}
              health={health}
              reloading={reloading}
              onChanged={refreshHealth}
              onNavigate={openPage}
            />
          )}
        </div>
      </div>
      <ToastContainer placement='top' />
    </Provider>
  )
}
