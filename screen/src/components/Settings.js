/*
 * Settings: the ERP's name, and the levers for rehearsing and presenting. The
 * levers live here rather than on the Dashboard so a prospect looking at the ERP
 * does not see them.
 */
import React, { useEffect, useState } from 'react'
import { Form, TextField, Switch, Button, Text, Heading, Divider, Flex, DialogTrigger, AlertDialog, ProgressCircle } from '@adobe/react-spectrum'
import Frame from './Frame'

const POLL_MS = 3000
const SYNC_WAIT_MS = 5 * 60 * 1000
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [syncNote, setSyncNote] = useState(null)
  useEffect(() => { api.settings().then(setSettings).catch(setError) }, [api])

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
    try { await api.wipe(); setSettings(await api.settings()); setError(null); setSyncNote(null); await onChanged() } catch (e) { setError(e) }
    setBusy(false)
  }

  // The integration does the work in the background (a web request is cut off after a
  // minute), so this asks, then watches the ERP's own last-import time move.
  async function sync () {
    setBusy(true)
    setError(null)
    const before = settings.lastImportAt || null
    try {
      setSyncNote('Asking the connected integration for its records…')
      await api.sync()
      setSyncNote('Syncing records…')
      const deadline = Date.now() + SYNC_WAIT_MS
      while (Date.now() < deadline) {
        await wait(POLL_MS)
        const health = await api.health()
        if (health.lastImportAt && health.lastImportAt !== before) {
          const counts = health.counts || {}
          setSyncNote(`Synced: ${counts.products ?? 0} products and ${counts.businessPartners ?? 0} business partners.`)
          setSettings((current) => ({ ...current, lastImportAt: health.lastImportAt }))
          await onChanged()
          return
        }
      }
      setSyncNote('Still syncing after five minutes. The Dashboard counts update when it finishes.')
    } catch (e) {
      setSyncNote(null)
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame title='Settings' error={error} loading={!settings}>
      {settings && (
        <>
          <Form maxWidth='size-4600'>
            <TextField label='Display name' value={settings.displayName} onChange={(v) => setSettings({ ...settings, displayName: v })} description='What this ERP is called on its screen and in Demo Builder.' />
            <Button variant='primary' onPress={saveName} isDisabled={busy}>Save</Button>
          </Form>

          <Section title='Records'>
            <Flex direction='column' gap='size-150' maxWidth='size-6000'>
              <Text>Brings the ERP's products and business partners up to date with the connected store. Existing records are updated; nothing is removed.</Text>
              <Flex gap='size-150' alignItems='center'>
                <Button variant='accent' onPress={sync} isDisabled={busy}>Sync records</Button>
                {busy && syncNote && <ProgressCircle size='S' aria-label='Syncing' isIndeterminate />}
                {syncNote && <Text>{syncNote}</Text>}
              </Flex>
              <Text>Last sync: {settings.lastImportAt || 'never'}. Last wipe: {settings.lastWipeAt || 'never'}.</Text>
              <DialogTrigger>
                <Button variant='negative' isDisabled={busy} width='size-2400'>Wipe all records</Button>
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
