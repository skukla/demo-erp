/*
 * Settings: the ERP's name, how it is dressed, and the levers for rehearsing and
 * presenting. The levers live here rather than on Home so a prospect looking at
 * the ERP does not see them.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { TextField, Button, Text, Flex, DialogTrigger, AlertDialog, ProgressCircle, InlineAlert, Heading, Content } from '@adobe/react-spectrum'
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

export default function Settings ({ api, onChanged, onPreview }) {
  const [settings, setSettings] = useState(null)
  const [structure, setStructure] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [sync, setSync] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  // What the last wipe removed, until a sync makes it stale.
  const [wiped, setWiped] = useState(null)
  // Its own flag: `busy` also covers the name save, which is not a wipe.
  const [wiping, setWiping] = useState(false)
  const [stalled, setStalled] = useState(false)
  /* The name as the ERP holds it, kept beside the one being typed so Save can be dark
     until there is something to save — the same rule the Appearance card follows.
     `settings.displayName` alone cannot answer that: it IS the edit in progress. */
  const [savedName, setSavedName] = useState('')
  const timer = useRef(null)

  // Follow the sync record until it ends. Also resumes a sync already running when
  // the page is opened.
  const follow = useCallback(async () => {
    clearTimeout(timer.current)
    try {
      const health = await api.health()
      setStructure(health.structure || null)
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
  }, [api, onChanged])

  useEffect(() => {
    api.settings().then((loaded) => {
      setSettings(loaded)
      setSavedName(loaded.displayName)
      setSync(loaded.sync || null)
      if (loaded.sync && ACTIVE.has(loaded.sync.state)) follow()
    }).catch(setError)
    // The Organisation and Warehouses cards read the structure the ERP derives.
    api.health().then((health) => setStructure(health.structure || null)).catch(setError)
    return () => clearTimeout(timer.current)
  }, [api, follow])

  async function renameWarehouse (code, name) {
    setRenaming(code)
    try {
      await api.saveSettings({ warehouses: { [code]: { name } } })
      const health = await api.health()
      setStructure(health.structure || null)
      setError(null)
      toastSaved('Warehouse renamed')
      onChanged()
    } catch (e) { setError(e) }
    setRenaming(null)
  }

  async function saveName () {
    try {
      const saved = await api.saveSettings({ displayName: settings.displayName })
      setSettings(saved)
      setSavedName(saved.displayName)
      setError(null)
      toastSaved('Name saved')
      onChanged()
    } catch (e) { setError(e) }
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
      setSavedName(after.displayName)
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
  // An all-space name is not a rename: the ERP trims it and would answer the old one.
  const renamed = Boolean(settings && settings.displayName.trim() && settings.displayName.trim() !== savedName)
  return (
    <Frame title='Settings' error={error} loading={!settings}>
      {settings && (
        <>
          {/* Two columns, because one was mostly empty: every card was width-capped and
              the right half of a wide monitor showed nothing while the page scrolled.
              Appearance is much the tallest, so it takes a column of its own and the two
              short cards stack beside it — which is what keeps the columns close to the
              same height rather than opening a new gap under the short one.

              Name leads, so it is the first card of the first column. What that costs is
              the narrow window: the columns stack in source order, so Records is read
              before Appearance. Wrong by preference, not by meaning. Fixing it needs
              either a hard-coded breakpoint — the rail is 208px and the content padding
              64, so two 380px columns want a ~1060px window, three numbers that rot the
              moment any one of them moves — or a container query, which puts layout
              containment on the element every screen scrolls inside. Neither is worth
              buying blind. */}
          <div className='erp-settings-columns'>
            <div className='erp-settings-column'>
              <Card
                title='Name'
                actions={<Button variant='primary' onPress={saveName} isDisabled={!renamed || busy}>Save</Button>}
              >
                {/* No width cap of its own any more: the column IS the cap, and a field
                    capped inside a capped column is what left the gap. */}
                <Flex direction='column' gap='size-100'>
                  <TextField
                    aria-label='Display name'
                    width='100%'
                    value={settings.displayName}
                    onChange={(v) => setSettings({ ...settings, displayName: v })}
                  />
                  <Text UNSAFE_className='erp-field-label'>
                    What this ERP is called on its screen and in Demo Builder.
                  </Text>
                </Flex>
              </Card>

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
