/*
 * The ERP's screen: a shell bar across the top and grouped side navigation beneath it.
 * Every page loads through the same `api` and shows the same error banner; the key from
 * Demo Builder's link is the only credential, so opened without one it says where to go
 * instead.
 *
 * Both halves are real SAP Fiori patterns rather than a compromise between them. Its
 * shell bar is the always-visible band carrying the product's name and anything global;
 * its Side Navigation is a vertical menu of GROUPS, items and child items. Business
 * Central arranges the same two ideas along the top instead. What neither has is a flat
 * list of areas, which is what this rail was.
 */
import React, { useEffect, useState, useCallback } from 'react'
import {
  Provider, defaultTheme, ActionButton, InlineAlert, Heading, Content, ToastContainer,
  MenuTrigger, Menu, Item
} from '@adobe/react-spectrum'
import { makeApi } from '../api'
import { pageFromHash } from '../pageRoute'
import { applyPalette, DEFAULT_APPEARANCE } from '../design/palette'
import Logo from './Logo'
import Dashboard from './Dashboard'
import Products from './Products'
import Partners from './Partners'
import Orders from './Orders'
import Pricing from './Pricing'
import Settings from './Settings'
import Events from './Events'

/* The menu, as an ERP arranges one: a home, then areas under the part of the business
   they belong to. Shipments and Invoices land under Sales when they exist, which is the
   other reason to group now rather than when the list is ten long. */
const AREAS = [
  { group: null, items: [{ key: 'dashboard', label: 'Dashboard', Component: Dashboard }] },
  { group: 'Sales', items: [{ key: 'orders', label: 'Sales Orders', Component: Orders }] },
  {
    group: 'Master Data',
    items: [
      { key: 'products', label: 'Products', Component: Products },
      { key: 'partners', label: 'Customers', Component: Partners },
      { key: 'pricing', label: 'Pricing Rules', Component: Pricing }
    ]
  },
  { group: 'Monitoring', items: [{ key: 'events', label: 'Event Journal', Component: Events }] },
  /* Settings is not monitoring — it is how the ERP is set up, which is a different kind
     of thing from the work. Fiori's Side Navigation has a FOOTER area for exactly this:
     it stays at the bottom, does not scroll away with the areas above it, and is
     separated by a divider. */
  { group: null, footer: true, items: [{ key: 'settings', label: 'Settings', Component: Settings }] }
]

const PAGES = AREAS.flatMap((area) => area.items)

/* What the shell bar says before the ERP has answered. The ERP always has a name — it
   defaults to Acme ERP when the deploy named none — so this is only the moment between
   opening the page and health arriving, and it is drawn with the default mark. */
const FALLBACK_NAME = 'ERP'

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
  /* What Settings is showing the SC before they save it. Null the rest of the time, so
     the saved appearance is the truth everywhere except while somebody is choosing.
     Settings clears it when it unmounts, which is what makes leaving without saving put
     the ERP back the way it was. */
  const [preview, setPreview] = useState(null)
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
  /* The look, from the ERP unless somebody is trying one on. Before health arrives this
     is the default, which is why the first paint is the default palette rather than an
     unstyled one. */
  const look = preview || (health && health.appearance) || DEFAULT_APPEARANCE
  const shape = look.nav
  const name = health ? health.displayName : FALLBACK_NAME
  // Writing the eight custom properties onto <html>, where they beat tokens.css.
  useEffect(() => { applyPalette(look.palette) }, [look.palette])
  return (
    <Provider theme={defaultTheme} colorScheme='light' height='100vh'>
      {/* Plain elements, not Spectrum's Grid and View: the rail moves to the top on a
          narrow screen, and that is a media rule rather than a token (design/app.css). */}
      <div className='erp-shell'>
        <header className='erp-shellbar'>
          <Logo logo={look.logo} name={name} />
          <span className='erp-shellbar-name'>{name}</span>
        </header>
        {shape === 'top' && (
          <nav className='erp-topnav' aria-label='Areas'>
            {AREAS.map((area) => (area.group === null
              /* A group of one, and the home, are links rather than menus: an audience
                 should not have to open a menu to find a single thing inside it. */
              ? area.items.map((p) => (
                <button
                  className='erp-topnav-item'
                  type='button'
                  key={p.key}
                  aria-current={p.key === page ? 'page' : undefined}
                  onClick={() => { openPage(p.key); revisit() }}
                >
                  {p.label}
                </button>
                ))
              : (
                <MenuTrigger key={area.group}>
                  <ActionButton
                    isQuiet
                    UNSAFE_className='erp-topnav-item'
                    aria-current={area.items.some((p) => p.key === page) ? 'page' : undefined}
                  >
                    {area.group}
                  </ActionButton>
                  <Menu onAction={(key) => { openPage(String(key)); revisit() }}>
                    {area.items.map((p) => <Item key={p.key}>{p.label}</Item>)}
                  </Menu>
                </MenuTrigger>
                )
            ))}
          </nav>
        )}
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
        {shape === 'rail' && (
        <nav className='erp-rail' aria-label='Areas'>
          {AREAS.map((area) => (
            <div
              className={area.footer ? 'erp-rail-group erp-rail-footer' : 'erp-rail-group'}
              key={area.group || (area.footer ? 'footer' : 'home')}
            >
              {area.group && <p className='erp-rail-group-name'>{area.group}</p>}
              <div className='erp-rail-items'>
                {area.items.map((p) => (
                  <ActionButton
                    key={p.key}
                    isQuiet
                    aria-current={p.key === page ? 'page' : undefined}
                    onPress={() => { openPage(p.key); revisit() }}
                  >
                    {p.label}
                  </ActionButton>
                ))}
              </div>
            </div>
          ))}
        </nav>
        )}
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
              onPreview={setPreview}
            />
          )}
          </div>
        </div>
      </div>
      <ToastContainer placement='top' />
    </Provider>
  )
}
