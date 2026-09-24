/*
 * Shipments: the list. Every shipment across every order, newest number first; choose a
 * row to open the shipment's document. Shipments are created on their order, so the
 * list has no Add — it is where an SC finds the one to post.
 */
import React, { useMemo, useState } from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, StatusLight, Picker, Item } from '@adobe/react-spectrum'
import Frame from './Frame'
import { useLoad } from './useLoad'
import { useColumnWidths } from './columnWidths'
import { useGridView, GridSearch } from './GridView'
import { useTrail, OpenDocument, useOpenFromQuery } from './Documents'
import { formatDate } from '../formatStamp'

const SHIPMENT_COLUMNS = [
  { key: 'number', width: 150 },
  { key: 'date', width: 130 },
  { key: 'order', width: 150 },
  { key: 'partner', width: '2fr', minWidth: 200 },
  { key: 'warehouse', width: '1fr', minWidth: 160 },
  { key: 'qty', width: 100 },
  { key: 'status', width: 120 }
]

/* A shipment list without who it went to is a warehouse's view, not a sales view. */
const soldTo = (s) => (s.partnerName ? `${s.partnerId} · ${s.partnerName}` : (s.partnerId || '—'))

const statusText = (s) => (s.status === 'posted' ? 'Posted' : 'Open')

const SHIPMENT_GRID = {
  fields: [(s) => s.number, (s) => s.orderNumber, (s) => s.partnerId, (s) => s.partnerName, (s) => s.warehouseName || s.warehouse, (s) => statusText(s)],
  values: {
    number: (s) => s.number,
    date: (s) => Date.parse(s.postedAt || s.createdAt) || 0,
    order: (s) => s.orderNumber,
    partner: (s) => s.partnerId || '',
    warehouse: (s) => s.warehouseName || s.warehouse || '',
    qty: (s) => s.qty,
    status: (s) => statusText(s)
  },
  sort: { column: 'number', direction: 'descending' }
}

const SHOW = [
  { key: 'all', label: 'All shipments' },
  { key: 'open', label: 'To post' },
  { key: 'posted', label: 'Posted' }
]
const showKey = (asked) => (SHOW.some((x) => x.key === asked) ? asked : 'all')

export default function Shipments ({ api, query = {}, onChanged, onNavigate }) {
  const widths = useColumnWidths('shipments', SHIPMENT_COLUMNS)
  const { rows, error, reload } = useLoad(() => api.shipments(), [api])
  // Home's "Shipments to post" lands here with ?work=open.
  const [show, setShow] = useState(() => showKey(query.work))
  const shown = useMemo(() => {
    if (!rows || show === 'all') return rows
    return rows.filter((s) => (show === 'posted' ? s.status === 'posted' : s.status !== 'posted'))
  }, [rows, show])
  const view = useGridView(shown, SHIPMENT_GRID)
  const trail = useTrail('Shipments')
  useOpenFromQuery(trail, query, 'shipment')

  if (trail.top) {
    return <OpenDocument trail={trail} api={api} onChanged={onChanged} onNavigate={onNavigate} onClose={reload} />
  }

  return (
    <Frame title='Shipments' error={error} loading={!rows}>
      <GridSearch placeholder='Shipment, order, customer or warehouse' view={view}>
        <Picker aria-label='Status' label='Show' selectedKey={show} onSelectionChange={(k) => setShow(String(k))} items={SHOW}>
          {(x) => <Item key={x.key}>{x.label}</Item>}
        </Picker>
      </GridSearch>
      <TableView {...widths.tableProps} {...view.tableProps}
        aria-label='Shipments' density='compact' overflowMode='wrap' marginTop='size-200'
        UNSAFE_className='erp-rows-open'
        selectionMode='none' onAction={(key) => trail.open('shipment', String(key))}>
        <TableHeader>
          <Column key='number' {...widths.columnProps('number')} allowsSorting>Shipment</Column>
          <Column key='date' {...widths.columnProps('date')} allowsSorting>Shipment date</Column>
          <Column key='order' {...widths.columnProps('order')} allowsSorting>Sales order</Column>
          <Column key='partner' {...widths.columnProps('partner')} allowsSorting>Sold-to</Column>
          <Column key='warehouse' {...widths.columnProps('warehouse')} allowsSorting>Ship-from</Column>
          <Column key='qty' {...widths.columnProps('qty')} align='end' allowsSorting>Quantity</Column>
          <Column key='status' {...widths.columnProps('status')} allowsSorting>Status</Column>
        </TableHeader>
        <TableBody items={view.items}>
          {(s) => (
            <Row key={s.number}>
              <Cell><span className='erp-key'>{s.number}</span></Cell>
              <Cell>{formatDate(s.postedAt || s.createdAt)}</Cell>
              <Cell>{s.orderNumber}</Cell>
              <Cell>{soldTo(s)}</Cell>
              <Cell>{s.warehouseName || s.warehouse || '—'}</Cell>
              <Cell>{s.qty}</Cell>
              <Cell><StatusLight variant={s.status === 'posted' ? 'positive' : 'notice'}>{statusText(s)}</StatusLight></Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
