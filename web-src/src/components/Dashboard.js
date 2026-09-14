import React, { useState } from 'react'
import { Flex, View, Heading, Text, Button, StatusLight, DialogTrigger, AlertDialog } from '@adobe/react-spectrum'
import Frame from './Frame'

function Stat ({ label, value }) {
  return (
    <View backgroundColor='gray-75' borderRadius='medium' padding='size-200' minWidth='size-2000'>
      <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-700)' }}>{label}</Text>
      <Heading level={2} marginY='size-50'>{value}</Heading>
    </View>
  )
}

export default function Dashboard ({ api, health, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const counts = (health && health.counts) || {}

  async function toggleOffline () {
    setBusy(true)
    try { await api.saveSettings({ offline: !health.offline }); setError(null); await onChanged() } catch (e) { setError(e) }
    setBusy(false)
  }
  async function wipe () {
    setBusy(true)
    try { await api.wipe(); setError(null); await onChanged() } catch (e) { setError(e) }
    setBusy(false)
  }

  return (
    <Frame title='Dashboard' error={error} loading={!health}>
      {health && (
        <>
          <Flex gap='size-200' wrap marginBottom='size-300'>
            <Stat label='Materials' value={counts.materials ?? 0} />
            <Stat label='Business partners' value={counts.businessPartners ?? 0} />
            <Stat label='Sales orders' value={counts.salesOrders ?? 0} />
            <Stat label='Pricing conditions' value={counts.pricingConditions ?? 0} />
            <Stat label='Outbox pending' value={counts.outbox ?? 0} />
          </Flex>
          <Flex direction='column' gap='size-100' marginBottom='size-300'>
            <StatusLight variant={health.offline ? 'negative' : 'positive'}>
              {health.offline ? 'Offline: the API refuses every record request with 503, the way an ERP outage looks to an integration.' : 'Online'}
            </StatusLight>
            <Text>Last import: {health.lastImportAt || 'never'}. Last wipe: {health.lastWipeAt || 'never'}.</Text>
          </Flex>
          <Flex gap='size-150'>
            <Button variant='primary' onPress={toggleOffline} isDisabled={busy}>{health.offline ? 'Bring online' : 'Take offline'}</Button>
            <DialogTrigger>
              <Button variant='negative' isDisabled={busy}>Wipe all records</Button>
              <AlertDialog title='Wipe all records?' variant='destructive' primaryActionLabel='Wipe' cancelLabel='Cancel' onPrimaryAction={wipe}>
                Every material, business partner, pricing condition, sales order and outbox entry is removed. The order counter and the settings stay. Demo Builder's reset does this and then re-imports from Commerce; on its own this leaves the ERP empty.
              </AlertDialog>
            </DialogTrigger>
          </Flex>
        </>
      )}
    </Frame>
  )
}
