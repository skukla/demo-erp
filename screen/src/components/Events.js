import React, { useEffect, useMemo, useState } from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, StatusLight, Button, Text, Picker, Item } from '@adobe/react-spectrum'
import Frame from './Frame'
import EventDetail from './EventDetail'
import { formatStamp } from '../formatStamp'
import { useLoad } from './useLoad'
import { useColumnWidths } from './columnWidths'
import { useGridView, GridSearch } from './GridView'
import { LIST_OF } from './Home'

/* The event name and its detail are the long ones, so they take the slack between
   them: an event name runs to "be-observer.sales_order_shipment_create". */
const EVENT_COLUMNS = [
  { key: 'at', width: 200 },
  { key: 'direction', width: 180 },
  { key: 'event', width: '1fr', minWidth: 270 },
  // "failed after 10 tries" is the longest of these, and wrapping doubles the row.
  { key: 'state', width: 190 },
  { key: 'detail', width: '1fr', minWidth: 200 }
]

/** An entry journaled before the direction was recorded is outbound: nothing else was. */
const isIncoming = (e) => e.direction === 'in'

/** One word for where an entry got to, used by both the status light and the filter. */
function stateKey (e) {
  if (isIncoming(e)) return 'received'
  if (e.delivered) return 'delivered'
  if (e.failed) return 'failed'
  return 'pending'
}

const DIRECTIONS = [
  { key: 'all', label: 'Both directions' },
  { key: 'in', label: 'From Commerce' },
  { key: 'out', label: 'To Commerce' }
]
const STATES = [
  { key: 'all', label: 'Any status' },
  { key: 'received', label: 'Received' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'pending', label: 'Pending' },
  { key: 'failed', label: 'Failed' }
]

/** The sentence for a row: the ERP's (lib/journal), else what the row carried. */
const detailText = (e) => (e.describe && e.describe.text) || (isIncoming(e) ? e.summary : (e.lastError || JSON.stringify(e.value).slice(0, 120)))
const eventName = (e) => (e.describe && e.describe.name) || e.event || ''

/* The journal refreshes itself while open, so "watch the event go" needs no rail click.
   Slow enough that a screen check's three agreeing samples fit between two reads. */
const REFRESH_MS = 8000

const EVENT_GRID = {
  fields: [(e) => e.event, (e) => eventName(e), (e) => detailText(e), (e) => e.lastError],
  values: {
    at: (e) => Date.parse(e.at) || 0,
    direction: (e) => (isIncoming(e) ? 'From Commerce' : 'To Commerce'),
    event: (e) => eventName(e),
    state: (e) => stateKey(e)
  },
  sort: { column: 'at', direction: 'descending' }
}

/**
 * The ERP's event log, both ways: what arrived from Commerce and what the ERP did with
 * it, and what the ERP published and whether it was delivered. Until 2026-09-18 only
 * the outbound half was here, so a change Commerce sent left no trace on this screen.
 */
export default function Events ({ api, query = {}, onNavigate }) {
  const widths = useColumnWidths('events', EVENT_COLUMNS)
  const [meta, setMeta] = useState({})
  const { rows, error, reload } = useLoad(async () => {
    const data = await api.events()
    setMeta({ webhookUrl: data.webhookUrl, pending: data.pending, failed: data.failed })
    return data.items
  }, [api])
  const [actionError, setActionError] = useState(null)
  // The event opened from the table, as Products opens a product.
  const [openId, setOpenId] = useState(null)
  useEffect(() => {
    if (openId) return undefined
    const id = setInterval(reload, REFRESH_MS)
    return () => clearInterval(id)
  }, [reload, openId])
  /** A document named in a sentence opens on its own list page. */
  const openDocument = (link) => onNavigate && onNavigate(LIST_OF[link.kind] || 'orders', { open: link.number })
  async function retry () {
    try { await api.retryEvents(); setActionError(null); await reload() } catch (e) { setActionError(e) }
  }
  async function requeue () {
    try { await api.requeueEvents(); await api.retryEvents(); setActionError(null); await reload() } catch (e) { setActionError(e) }
  }
  function state (e) {
    const key = stateKey(e)
    if (key === 'received') return { variant: 'positive', text: 'received' }
    if (key === 'delivered') return { variant: 'positive', text: 'delivered' }
    if (key === 'failed') return { variant: 'negative', text: `failed after ${e.attempts} tries` }
    return { variant: 'notice', text: `pending (${e.attempts || 0} tries)` }
  }
  const [direction, setDirection] = useState('all')
  // Home's "Events not delivered" and "Events waiting" land here with ?work=failed / pending.
  const [shown, setShown] = useState(() => (STATES.some((x) => x.key === query.work) ? query.work : 'all'))
  const filtered = useMemo(() => (rows || []).filter((e) => {
    if (direction !== 'all' && (isIncoming(e) ? 'in' : 'out') !== direction) return false
    return shown === 'all' || stateKey(e) === shown
  }), [rows, direction, shown])
  const view = useGridView(filtered, EVENT_GRID)

  const opened = openId && (rows || []).find((e) => e._id === openId)
  if (opened) return <EventDetail entry={opened} state={state(opened)} onBack={() => setOpenId(null)} />

  return (
    <Frame title='Event Journal' error={actionError || error} loading={!rows}
      actions={<><Button variant='secondary' onPress={retry} isDisabled={!meta.pending}>Retry pending</Button><Button variant='secondary' onPress={requeue} isDisabled={!meta.failed} marginStart='size-100'>Requeue failed</Button></>}>
      <Text>Changes from Commerce, and what this ERP published to {meta.webhookUrl || 'no subscriber (no namespace)'}: {meta.pending ?? 0} waiting to be delivered, {meta.failed ?? 0} failed (an event is failed after ten attempts).</Text>
      <GridSearch placeholder='Event name or detail' view={view}>
        <Picker aria-label='Direction' label='Direction' selectedKey={direction} onSelectionChange={(k) => setDirection(String(k))} items={DIRECTIONS}>
          {(d) => <Item key={d.key}>{d.label}</Item>}
        </Picker>
        <Picker aria-label='Status' label='Status' selectedKey={shown} onSelectionChange={(k) => setShown(String(k))} items={STATES}>
          {(x) => <Item key={x.key}>{x.label}</Item>}
        </Picker>
      </GridSearch>
      <TableView {...widths.tableProps} {...view.tableProps} aria-label='Event Journal' density='compact' overflowMode='wrap' marginTop='size-200'
        UNSAFE_className='erp-rows-open'
        selectionMode='none' onAction={(key) => setOpenId(String(key))}>
        <TableHeader>
          <Column key='at' {...widths.columnProps('at')} allowsSorting>When</Column>
          <Column key='direction' {...widths.columnProps('direction')} allowsSorting>Direction</Column>
          <Column key='event' {...widths.columnProps('event')} allowsSorting>Event</Column>
          <Column key='state' {...widths.columnProps('state')} allowsSorting>Status</Column>
          <Column key='detail' {...widths.columnProps('detail')}>Detail</Column>
        </TableHeader>
        <TableBody items={view.items}>
          {(e) => (
            <Row key={e._id}>
              <Cell>{formatStamp(e.at)}</Cell>
              <Cell>{isIncoming(e) ? '← From Commerce' : '→ To Commerce'}</Cell>
              <Cell>{eventName(e)}</Cell>
              <Cell><StatusLight variant={state(e).variant}>{state(e).text}</StatusLight></Cell>
              <Cell>
                {detailText(e)}
                {(e.describe && e.describe.links || []).map((link) => (
                  <button type='button' className='erp-link erp-journal-link' key={`${link.kind}:${link.number}`} onClick={() => openDocument(link)}>
                    <span className='erp-key'>{link.number}</span>
                  </button>
                ))}
              </Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
