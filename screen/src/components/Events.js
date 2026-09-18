import React, { useState } from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, StatusLight, Button, Text } from '@adobe/react-spectrum'
import Frame from './Frame'
import { useLoad } from './useLoad'
import { useColumnWidths } from './columnWidths'

const EVENT_COLUMNS = [
  { key: 'at', width: 200 },
  { key: 'direction', width: 150 },
  { key: 'event' },
  { key: 'state', width: 160 },
  { key: 'detail' }
]

/** An entry journaled before the direction was recorded is outbound: nothing else was. */
const isIncoming = (e) => e.direction === 'in'

/**
 * The ERP's event log, both ways: what arrived from Commerce and what the ERP did with
 * it, and what the ERP published and whether it was delivered. Until 2026-09-18 only
 * the outbound half was here, so a change Commerce sent left no trace on this screen.
 */
export default function Events ({ api }) {
  const widths = useColumnWidths('events', EVENT_COLUMNS)
  const [meta, setMeta] = useState({})
  const { rows, error, reload } = useLoad(async () => {
    const data = await api.events()
    setMeta({ webhookUrl: data.webhookUrl, pending: data.pending, failed: data.failed })
    return data.items
  }, [api])
  const [actionError, setActionError] = useState(null)
  async function retry () {
    try { await api.retryEvents(); setActionError(null); await reload() } catch (e) { setActionError(e) }
  }
  async function requeue () {
    try { await api.requeueEvents(); await api.retryEvents(); setActionError(null); await reload() } catch (e) { setActionError(e) }
  }
  function state (e) {
    if (isIncoming(e)) return { variant: 'positive', text: 'received' }
    if (e.delivered) return { variant: 'positive', text: 'delivered' }
    if (e.failed) return { variant: 'negative', text: `failed after ${e.attempts} tries` }
    return { variant: 'notice', text: `pending (${e.attempts || 0} tries)` }
  }
  return (
    <Frame title='Events' error={actionError || error} loading={!rows}
      actions={<><Button variant='secondary' onPress={retry} isDisabled={!meta.pending}>Retry pending</Button><Button variant='secondary' onPress={requeue} isDisabled={!meta.failed} marginStart='size-100'>Requeue failed</Button></>}>
      <Text>Changes from Commerce, and what this ERP published to {meta.webhookUrl || 'no subscriber (no namespace)'}: {meta.pending ?? 0} waiting to be delivered, {meta.failed ?? 0} failed (an event is failed after ten attempts).</Text>
      <TableView {...widths.tableProps} aria-label='Events' density='compact' overflowMode='wrap' marginTop='size-200'>
        <TableHeader>
          <Column key='at' {...widths.columnProps('at')}>When</Column>
          <Column key='direction' {...widths.columnProps('direction')}>Direction</Column>
          <Column key='event' {...widths.columnProps('event')}>Event</Column>
          <Column key='state' {...widths.columnProps('state')}>Status</Column>
          <Column key='detail' {...widths.columnProps('detail')}>Detail</Column>
        </TableHeader>
        <TableBody items={rows || []}>
          {(e) => (
            <Row key={e._id}>
              <Cell>{e.at}</Cell>
              <Cell>{isIncoming(e) ? '← From Commerce' : '→ To Commerce'}</Cell>
              <Cell>{e.event}</Cell>
              <Cell><StatusLight variant={state(e).variant}>{state(e).text}</StatusLight></Cell>
              <Cell>{isIncoming(e) ? e.summary : (e.lastError || JSON.stringify(e.value).slice(0, 120))}</Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
