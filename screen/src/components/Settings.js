/*
 * Settings: the ERP's name, how it is dressed, and the levers for rehearsing and
 * presenting. The levers live here rather than on Home so a prospect looking at
 * the ERP does not see them.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Button, Text, Flex, DialogTrigger, AlertDialog, ProgressCircle, InlineAlert, Heading, Content } from '@adobe/react-spectrum'
import Frame from './Frame'
import Card from './Card'
import Field from './Field'
import EditableText from './EditableText'
import AppearanceSettings from './AppearanceSettings'
import SyncProgress from './SyncProgress'
import { formatStamp } from '../formatStamp'
import { wipeSummary } from '../wipeSummary'
import { toastSaved } from './toast'

const POLL_MS = 2000
// No word from the integration for this long reads as stalled (it may still be working).
const STALL_MS = 60 * 1000
const ACTIVE = new Set(['requested', 'running'])

/**
 * The selling structure, read-only: this ERP as a company code, its sales organisations
 * (one per Commerce website, from the integration's per-website setting), its warehouses
 * (one per Commerce inventory source, under the ERP's own names). Derived by the ERP on
 * every read and rebuilt by a sync, so a wipe and a mirror give the same card.
 */
function OrganisationCard ({ structure }) {
  if (!structure) return null
  const cc = structure.companyCode
  return (
    <Card title='Organisation'>
      <Flex direction='column' gap='size-200'>
        <Field label='Company code'>
          {`${cc.code} · ${cc.name}`}{cc.currency ? ` · ${cc.currency}` : ''}{cc.countryId ? ` · ${cc.countryId}` : ''}{cc.vatNumber ? ` · VAT ${cc.vatNumber}` : ''}
        </Field>
        <Field label='Sales organisations'>
          {structure.salesOrgs.length === 0
            ? 'None yet — a sync brings the websites'
            : (
              <ul className='erp-plain-list'>
                {structure.salesOrgs.map((o) => (
                  <li key={o.code}>
                    <Text>{`${o.code} · ${o.name}`}{o.websiteCode ? ` — website ${o.websiteCode}` : ''}{` · ${o.customers} customer${o.customers === 1 ? '' : 's'}, ${o.orders} order${o.orders === 1 ? '' : 's'}`}</Text>
                  </li>
                ))}
              </ul>
              )}
        </Field>
        {structure.unmapped.length > 0 && (
          <InlineAlert variant='notice'>
            <Heading>{structure.unmapped.length === 1 ? 'A website has no sales organisation' : 'Websites with no sales organisation'}</Heading>
            <Content>
              {structure.unmapped.map((code) => `Website ${code} has no sales organisation; its orders use 1000.`).join(' ')} Set one on the integration's Admin page (Structure), then sync.
            </Content>
          </InlineAlert>
        )}
      </Flex>
    </Card>
  )
}

/** The warehouses, each renamed in place; the Commerce source it stands for is read-only. */
function WarehousesCard ({ structure, saving, onRename }) {
  if (!structure) return null
  return (
    <Card title='Warehouses'>
      {structure.warehouses.length === 0
        ? <Text>None yet — a sync brings the inventory sources.</Text>
        : (
          <Flex direction='column' gap='size-150'>
            {structure.warehouses.map((w) => (
              <div key={w.code} className='erp-warehouse-row'>
                <EditableText label={`Name of ${w.code}`} value={w.name} isSaving={saving === w.code} onSave={(name) => onRename(w.code, name)} />
                <Text UNSAFE_className='erp-subtle'>{`Commerce source ${w.code}${w.commerceName && w.commerceName !== w.name ? ` · ${w.commerceName}` : ''} · ${w.products} product${w.products === 1 ? '' : 's'}`}</Text>
              </div>
            ))}
            <Text UNSAFE_className='erp-field-label'>The ERP's own name for each plant; click one to rename it. Commerce keeps its source code and name.</Text>
          </Flex>
          )}
    </Card>
  )
}

/**
 * Document numbering: each document type's range and its next number, read without
 * reserving it (lib/counters peek). Every ERP audience knows number ranges; a counter never
 * rewinds, not even across a wipe, so a number an order carries from before a reset cannot
 * be handed out again. Beside it, the currency money with no currency of its own is shown in.
 */
function NumberingCard ({ numbering, currency }) {
  if (!numbering) return null
  const ranges = [
    { label: 'Sales orders', key: 'salesOrder', from: '0000001000' },
    { label: 'Shipments', key: 'shipment', from: '8000000001' },
    { label: 'Invoices', key: 'invoice', from: '9000000001' }
  ]
  return (
    <Card title='Document numbering'>
      <Flex direction='column' gap='size-200'>
        <Flex gap='size-400' wrap>
          {ranges.map((r) => (
            <Field key={r.key} label={`${r.label} · from ${r.from}`}>
              <Text UNSAFE_className='erp-key'>{numbering[r.key]}</Text>
            </Field>
          ))}
        </Flex>
        <Text UNSAFE_className='erp-subtle'>The next number of each range. A counter never rewinds, not even across a wipe, so no number is handed out twice.</Text>
        <Field label='Currency'>
          {currency
            ? `${currency} — money with no currency of its own (list prices, credit limits) is shown in the company code's currency`
            : "USD until a sync names the website the company code sells through; then that website's base currency"}
        </Field>
      </Flex>
    </Card>
  )
}

export default function Settings ({ api, onChanged, onPreview }) {
  const [settings, setSettings] = useState(null)
  const [structure, setStructure] = useState(null)
  // The next document numbers and the ERP's own currency, from the same health read.
  const [numbering, setNumbering] = useState(null)
  const [currency, setCurrency] = useState(null)
  // What every health read hands the cards.
  const takeHealth = useCallback((health) => {
    setStructure(health.structure || null)
    setNumbering(health.numbering || null)
    setCurrency(health.currency || null)
  }, [])
  const [renaming, setRenaming] = useState(null)
  const [sync, setSync] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  // What the last wipe removed, until a sync makes it stale.
  const [wiped, setWiped] = useState(null)
  // Its own flag: `busy` also covers the appearance save, which is not a wipe.
  const [wiping, setWiping] = useState(false)
  const [stalled, setStalled] = useState(false)
  const timer = useRef(null)

  // Follow the sync record until it ends. Also resumes a sync already running when
  // the page is opened.
  const follow = useCallback(async () => {
    clearTimeout(timer.current)
    try {
      const health = await api.health()
      takeHealth(health)
      const next = health.sync || null
      setSync(next)
      setStalled(Boolean(next && ACTIVE.has(next.state) && Date.now() - Date.parse(next.updatedAt) > STALL_MS))
      if (next && ACTIVE.has(next.state)) {
        timer.current = setTimeout(follow, POLL_MS)
      } else {
        setSettings((current) => current && ({ ...current, lastImportAt: health.lastImportAt, sync: next }))
        await onChanged()
      }
    } catch (e) {
      setError(e)
    }
  }, [api, onChanged, takeHealth])

  useEffect(() => {
    api.settings().then((loaded) => {
      setSettings(loaded)
      setSync(loaded.sync || null)
      if (loaded.sync && ACTIVE.has(loaded.sync.state)) follow()
    }).catch(setError)
    // The Organisation and Warehouses cards read the structure the ERP derives.
    api.health().then(takeHealth).catch(setError)
    return () => clearTimeout(timer.current)
  }, [api, follow, takeHealth])

  async function renameWarehouse (code, name) {
    setRenaming(code)
    try {
      await api.saveSettings({ warehouses: { [code]: { name } } })
      const health = await api.health()
      takeHealth(health)
      setError(null)
      toastSaved('Warehouse renamed')
      onChanged()
    } catch (e) { setError(e) }
    setRenaming(null)
  }

  async function wipe () {
    setBusy(true)
    setWiping(true)
    try {
      const result = await api.wipe()
      setWiped(result.wiped || {})
      // The ERP drops the sync record on a wipe; the screen follows at once
      // rather than waiting for the next read.
      setSync(null)
      const after = await api.settings()
      setSettings(after)
      setError(null)
      await onChanged()
    } catch (e) { setError(e) }
    setWiping(false)
    setBusy(false)
  }

  async function startSync () {
    setError(null)
    setWiped(null)
    setSync({ state: 'requested', updatedAt: new Date().toISOString() })
    try {
      await api.sync()
    } catch (e) {
      // The ERP recorded the refusal; the record says why.
    }
    await follow()
  }

  const syncing = Boolean(sync && ACTIVE.has(sync.state))
  return (
    <Frame title='Settings' error={error} loading={!settings}>
      {settings && (
        <>
          {/* Two columns, because one was mostly empty: every card was width-capped and
              the right half of a wide monitor showed nothing while the page scrolled.
              Appearance is much the tallest, so it takes a column of its own and the two
              short cards stack beside it — which is what keeps the columns close to the
              same height rather than opening a new gap under the short one.

              The name has no card: it is fixed when the ERP is added (2026-09-25). What the
              column order costs is the narrow window: the columns stack in source order, so
              Records is read before Appearance. Wrong by preference, not by meaning. Fixing it needs
              either a hard-coded breakpoint — the rail is 208px and the content padding
              64, so two 380px columns want a ~1060px window, three numbers that rot the
              moment any one of them moves — or a container query, which puts layout
              containment on the element every screen scrolls inside. Neither is worth
              buying blind. */}
          <div className='erp-settings-columns'>
            <div className='erp-settings-column'>
              <Card title='Records'>
                <Flex direction='column' gap='size-200'>
                  <Text>Brings the ERP's products and customers up to date with the connected store. Existing records are updated; nothing is removed.</Text>
                  {/* Each button as wide as its label, in one row; the destructive
                      one set apart rather than sized differently. */}
                  <Flex gap='size-300' alignItems='center'>
                    <Button variant='accent' onPress={startSync} isDisabled={busy || syncing}>Sync records</Button>
                    <DialogTrigger>
                      <Button variant='negative' isDisabled={busy || syncing}>Wipe all records</Button>
                      <AlertDialog title='Wipe All Records?' variant='destructive' primaryActionLabel='Wipe' cancelLabel='Cancel' onPrimaryAction={wipe}>
                        Every product, customer, pricing condition, sales order and event is removed. The order counter and the settings stay. Sync records fills the ERP again.
                      </AlertDialog>
                    </DialogTrigger>
                  </Flex>
                  {wiping && (
                    <Flex gap='size-100' alignItems='center'>
                      <ProgressCircle size='S' aria-label='Wiping' isIndeterminate />
                      <Text>Wiping records…</Text>
                    </Flex>
                  )}
                  <SyncProgress sync={sync} stalled={stalled} />
                  {wiped && <Text>{wipeSummary(wiped)}</Text>}
                  <Text UNSAFE_className='erp-field-label'>
                    Last sync: {formatStamp(settings.lastImportAt)}. Last wipe: {formatStamp(settings.lastWipeAt)}.
                  </Text>
                </Flex>
              </Card>

              <NumberingCard numbering={numbering} currency={currency} />
            </div>

            <div className='erp-settings-column'>
              <OrganisationCard structure={structure} />
              <WarehousesCard structure={structure} saving={renaming} onRename={renameWarehouse} />
              <Card title='Appearance'>
                <AppearanceSettings
                  api={api}
                  saved={settings.appearance}
                  name={settings.displayName}
                  onChanged={onChanged}
                  onPreview={onPreview}
                  disabled={busy}
                />
              </Card>
            </div>
          </div>

        </>
      )}
    </Frame>
  )
}
