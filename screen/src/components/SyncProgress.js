/*
 * What the current sync is doing, from the ERP's own sync record: waiting for the
 * integration, reading the store, then partners and products with counts, and how
 * it ended.
 */
import React from 'react'
import { Flex, Text, ProgressBar, ProgressCircle, InlineAlert, Heading, Content } from '@adobe/react-spectrum'

const BAR_LABEL = { partners: 'Business partners', products: 'Products' }

const PHASE_TEXT = {
  reading: 'Reading products and companies from the connected store…',
  partners: 'Importing business partners…',
  products: 'Importing products…'
}

function Bar ({ label, value }) {
  if (!value) return null
  return (
    <ProgressBar
      label={label}
      value={value.done}
      maxValue={Math.max(value.total, 1)}
      valueLabel={`${value.done} of ${value.total}`}
      width='size-4600'
    />
  )
}

/** A line of text for a sync record, for the waiting and reading states. */
export function syncHeadline (sync) {
  if (!sync) return null
  if (sync.state === 'requested') return 'Waiting for the connected integration to start…'
  if (sync.state === 'running') {
    // The phase's own count, so the line moves with the bar instead of sitting
    // on one sentence for the whole import.
    const value = sync[sync.phase]
    const of = value && value.total ? ` — ${value.done} of ${value.total}` : ''
    return `${PHASE_TEXT[sync.phase] || 'Syncing records…'}${of}`
  }
  if (sync.state === 'done') {
    const products = sync.products ? sync.products.total : 0
    const partners = sync.partners ? sync.partners.total : 0
    return `Synced ${products} products and ${partners} business partners.`
  }
  return null
}

export default function SyncProgress ({ sync, stalled }) {
  if (!sync) return null
  if (sync.state === 'failed') {
    return (
      <InlineAlert variant='negative' maxWidth='size-6000'>
        <Heading>The sync did not finish</Heading>
        <Content>{sync.error}</Content>
      </InlineAlert>
    )
  }
  const active = sync.state === 'requested' || sync.state === 'running'
  return (
    <Flex direction='column' gap='size-150'>
      <Flex gap='size-100' alignItems='center'>
        {active && <ProgressCircle size='S' aria-label='Syncing' isIndeterminate />}
        <Text>{syncHeadline(sync)}</Text>
      </Flex>
      {stalled && <Text>The integration has not reported for a while. It may still be working; this page keeps checking.</Text>}
      {/* ONE bar: the thing being imported right now. Two bars stayed on screen
          after the sync finished, describing work that was over — and after a
          wipe they described records that no longer existed. The Dashboard's
          counters are where the ERP's contents live. */}
      {active && <Bar label={BAR_LABEL[sync.phase]} value={sync[sync.phase]} />}
    </Flex>
  )
}
