import React, { useState } from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, StatusLight, Button, Text } from '@adobe/react-spectrum'
import Frame from './Frame'
import { useLoad } from './useLoad'

/** The ERP's outbound event log: what it published, to whom, and whether it arrived. */
export default function Events ({ api }) {
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
    if (e.delivered) return { variant: 'positive', text: 'yes' }
    if (e.failed) return { variant: 'negative', text: `failed after ${e.attempts} tries` }
    return { variant: 'notice', text: `pending (${e.attempts || 0} tries)` }
  }
  return (
    <Frame title='Events' error={actionError || error} loading={!rows}
      actions={<><Button variant='secondary' onPress={retry} isDisabled={!meta.pending}>Retry pending</Button><Button variant='secondary' onPress={requeue} isDisabled={!meta.failed} marginStart='size-100'>Requeue failed</Button></>}>
      <Text>Published to {meta.webhookUrl || 'no subscriber (no namespace)'}; {meta.pending ?? 0} pending, {meta.failed ?? 0} failed (an event is failed after ten attempts).</Text>
      <TableView aria-label='Events' density='compact' overflowMode='wrap' marginTop='size-200'>
        <TableHeader>
          <Column key='at' width={200}>When</Column>
          <Column key='event'>Event</Column>
          <Column key='state' width={160}>Delivered</Column>
          <Column key='detail'>Detail</Column>
        </TableHeader>
        <TableBody items={rows || []}>
          {(e) => (
            <Row key={e._id}>
              <Cell>{e.at}</Cell>
              <Cell>{e.event}</Cell>
              <Cell><StatusLight variant={state(e).variant}>{state(e).text}</StatusLight></Cell>
              <Cell>{e.lastError || JSON.stringify(e.value).slice(0, 120)}</Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
