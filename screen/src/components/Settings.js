/*
 * Settings: the ERP's name, how it is dressed, and the levers for rehearsing and
 * presenting. The levers live here rather than on Home so a prospect looking at
 * the ERP does not see them.
 */
import React, { useEffect, useState, useCallback } from 'react'
import { Button, Text, Flex, DialogTrigger, AlertDialog, ProgressCircle, InlineAlert, Heading, Content, NumberField } from '@adobe/react-spectrum'
import Frame from './Frame'
import Card from './Card'
import Field from './Field'
import EditableText from './EditableText'
import AppearanceSettings from './AppearanceSettings'
import { formatStamp } from '../formatStamp'
import { wipeSummary } from '../wipeSummary'
import { toastSaved } from './toast'

/**
 * The selling structure, read-only: this ERP as a company code, its sales organisations
 * (one per Commerce website, from the integration's per-website setting), its warehouses
 * (one per Commerce inventory source, under the ERP's own names). Derived by the ERP on
 * every read and rebuilt by each import, so a wipe and a fill give the same card.
 */
function OrganisationCard ({ structure }) {
  if (!structure) return null
  const cc = structure.companyCode
  return (
    <Card title='Organization'>
      <Flex direction='column' gap='size-200'>
        <Field label='Company code'>
          {`${cc.code} · ${cc.name}`}{cc.currency ? ` · ${cc.currency}` : ''}{cc.countryId ? ` · ${cc.countryId}` : ''}{cc.vatNumber ? ` · VAT ${cc.vatNumber}` : ''}
        </Field>
        <Field label='Sales organizations'>
          {structure.salesOrgs.length === 0
            ? 'None yet — loading demo data brings the websites'
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
            <Heading>{structure.unmapped.length === 1 ? 'A website has no sales organization' : 'Websites with no sales organization'}</Heading>
            <Content>
              {structure.unmapped.map((code) => `Website ${code} has no sales organization; its orders use 1000.`).join(' ')} Set one on the integration's Admin page (Structure), then sync.
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
        ? <Text>None yet — loading demo data brings the inventory sources.</Text>
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
    { label: 'Invoices', key: 'invoice', from: '9000000001' },
    { label: 'Price lists', key: 'contract', from: '4000000001' }
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
            : "USD until loading demo data names the website the company code sells through; then that website's base currency"}
        </Field>
      </Flex>
    </Card>
  )
}

/**
 * The maintenance window, as an ERP's basis team runs one: for a set time the ERP's
 * interfaces answer that it is unavailable, and it comes back by itself when the time is up
 * (lib/maintenance.js). Health and Settings stay open, so this card can always end it.
 */
function MaintenanceCard ({ maintenance, busy, onStart, onEnd }) {
  const [minutes, setMinutes] = useState(30)
  return (
    <Card title='Maintenance'>
      <Flex direction='column' gap='size-200'>
        <Text>During a maintenance window the ERP's interfaces answer that it is unavailable, and messages it sends wait until the window ends. It ends by itself when the time is up.</Text>
        {maintenance
          ? (
            <Flex gap='size-300' alignItems='center' wrap>
              <Text>{maintenance.message}</Text>
              <Button variant='secondary' isDisabled={busy} onPress={onEnd}>End maintenance</Button>
            </Flex>
            )
          : (
            <Flex gap='size-300' alignItems='end' wrap>
              <NumberField label='Minutes' value={minutes} onChange={setMinutes} minValue={1} maxValue={1440} step={1} width='size-1200' />
              <Button variant='secondary' isDisabled={busy || !(minutes >= 1)} onPress={() => onStart(minutes)}>Start maintenance</Button>
            </Flex>
            )}
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
    setMaintenance(health.maintenance || null)
  }, [])
  // The maintenance window in force, from health (null when none).
  const [maintenance, setMaintenance] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  // What the last wipe removed, until the next import makes it stale.
  const [wiped, setWiped] = useState(null)
  // Its own flag: `busy` also covers the appearance save, which is not a wipe.
  const [wiping, setWiping] = useState(false)

  useEffect(() => {
    api.settings().then(setSettings).catch(setError)
    // The Organisation and Warehouses cards read the structure the ERP derives.
    api.health().then(takeHealth).catch(setError)
  }, [api, takeHealth])

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

  async function maintain (start) {
    setBusy(true)
    try {
      const result = await start()
      setMaintenance(result.maintenance || null)
      setError(null)
      await onChanged()
    } catch (e) { setError(e) }
    setBusy(false)
  }

  async function wipe () {
    setBusy(true)
    setWiping(true)
    try {
      const result = await api.wipe()
      setWiped(result.wiped || {})
      const after = await api.settings()
      setSettings(after)
      setError(null)
      await onChanged()
    } catch (e) { setError(e) }
    setWiping(false)
    setBusy(false)
  }

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
                  <Text>Demo Builder fills the ERP's products and customers from the connected store: when the ERP is added, on Reset records, and with Load demo data on the ERP's card. Existing records are updated; nothing is removed.</Text>
                  <Flex gap='size-300' alignItems='center'>
                    <DialogTrigger>
                      <Button variant='negative' isDisabled={busy}>Wipe all records</Button>
                      <AlertDialog title='Wipe All Records?' variant='destructive' primaryActionLabel='Wipe' cancelLabel='Cancel' onPrimaryAction={wipe}>
                        Every product, customer, pricing condition, sales order and event is removed. The order counter and the settings stay. Load demo data in Demo Builder fills the ERP again.
                      </AlertDialog>
                    </DialogTrigger>
                  </Flex>
                  {wiping && (
                    <Flex gap='size-100' alignItems='center'>
                      <ProgressCircle size='S' aria-label='Wiping' isIndeterminate />
                      <Text>Wiping records…</Text>
                    </Flex>
                  )}
                  {wiped && <Text>{wipeSummary(wiped)}</Text>}
                  <Text UNSAFE_className='erp-field-label'>
                    Last import: {formatStamp(settings.lastImportAt)}. Last wipe: {formatStamp(settings.lastWipeAt)}.
                  </Text>
                </Flex>
              </Card>

              <MaintenanceCard maintenance={maintenance} busy={busy} onStart={(minutes) => maintain(() => api.startMaintenance(minutes))} onEnd={() => maintain(api.endMaintenance)} />
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
