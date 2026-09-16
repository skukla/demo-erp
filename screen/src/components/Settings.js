/*
 * Settings: the ERP's name, and the levers for rehearsing and presenting. The
 * levers live here rather than on the Dashboard so a prospect looking at the ERP
 * does not see them.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Form, TextField, Switch, Button, Text, Heading, Divider, Flex, DialogTrigger, AlertDialog } from '@adobe/react-spectrum'
import Frame from './Frame'
import SyncProgress from './SyncProgress'

const POLL_MS = 2000
// No word from the integration for this long reads as stalled (it may still be working).
const STALL_MS = 60 * 1000
const ACTIVE = new Set(['requested', 'running'])

function Section ({ title, children }) {
  return (
    <>
      <Divider size='S' marginY='size-300' />
      <Heading level={3} marginTop={0}>{title}</Heading>
      {children}
    </>
  )
}

export default function Settings ({ api, onChanged }) {
  const [settings, setSettings] = useState(null)
  const [sync, setSync] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [stalled, setStalled] = useState(false)
  const timer = useRef(null)

  // Follow the sync record until it ends. Also resumes a sync already running when
  // the page is opened.
  const follow = useCallback(async () => {
    clearTimeout(timer.current)
    try {
      const health = await api.health()
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
      setSync(loaded.sync || null)
      if (loaded.sync && ACTIVE.has(loaded.sync.state)) follow()
    }).catch(setError)
    return () => clearTimeout(timer.current)
  }, [api, follow])

  async function saveName () {
    try { setSettings(await api.saveSettings({ displayName: settings.displayName })); setError(null); onChanged() } catch (e) { setError(e) }
  }

  async function setOffline (offline) {
    setBusy(true)
    try { setSettings(await api.saveSettings({ offline })); setError(null); await onChanged() } catch (e) { setError(e) }
    setBusy(false)
  }

  async function wipe () {
    setBusy(true)
    try { await api.wipe(); setSettings(await api.settings()); setError(null); await onChanged() } catch (e) { setError(e) }
    setBusy(false)
  }

  async function startSync () {
    setError(null)
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
          <Form maxWidth='size-4600'>
            <TextField label='Display name' value={settings.displayName} onChange={(v) => setSettings({ ...settings, displayName: v })} description='What this ERP is called on its screen and in Demo Builder.' />
            <Button variant='primary' onPress={saveName} isDisabled={busy}>Save</Button>
          </Form>

          <Section title='Records'>
            <Flex direction='column' gap='size-200' maxWidth='size-6000'>
              <Text>Brings the ERP's products and business partners up to date with the connected store. Existing records are updated; nothing is removed.</Text>
              <Button variant='accent' onPress={startSync} isDisabled={busy || syncing} width='size-2000'>Sync records</Button>
              <SyncProgress sync={sync} stalled={stalled} />
              <Text>Last sync: {settings.lastImportAt || 'never'}. Last wipe: {settings.lastWipeAt || 'never'}.</Text>
              <DialogTrigger>
                <Button variant='negative' isDisabled={busy || syncing} width='size-2400'>Wipe all records</Button>
                <AlertDialog title='Wipe all records?' variant='destructive' primaryActionLabel='Wipe' cancelLabel='Cancel' onPrimaryAction={wipe}>
                  Every product, business partner, pricing condition, sales order and event is removed. The order counter and the settings stay. Sync records fills the ERP again.
                </AlertDialog>
              </DialogTrigger>
            </Flex>
          </Section>

          <Section title='Availability'>
            <Switch isSelected={Boolean(settings.offline)} onChange={setOffline} isDisabled={busy}>
              Offline: every record request answers 503, the way an unavailable ERP looks to the integration
            </Switch>
          </Section>
        </>
      )}
    </Frame>
  )
}
