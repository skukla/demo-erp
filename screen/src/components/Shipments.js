/*
 * Shipments: the list. Every shipment across every order, newest number first; choose a
 * row to open the shipment's document. Shipments are created on their order, so the
 * list has no Add — it is where an SC finds the one to post.
 */
import React from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, StatusLight } from '@adobe/react-spectrum'
import Frame from './Frame'
import { useLoad } from './useLoad'
import { useColumnWidths } from './columnWidths'
import { useGridView, GridSearch } from './GridView'
import { useTrail, OpenDocument } from './Documents'
import { formatDate } from '../formatStamp'

const SHIPMENT_COLUMNS = [
  { key: 'number', width: 165 },
  { key: 'date', width: 140 },
  { key: 'order', width: '1fr', minWidth: 170 },
  { key: 'warehouse', width: '1fr', minWidth: 160 },
  { key: 'qty', width: 110 },
  { key: 'status', width: 130 }
]

const statusText = (s) => (s.status === 'posted' ? 'Posted' : 'Open')

const SHIPMENT_GRID = {
  fields: [(s) => s.number, (s) => s.orderNumber, (s) => s.warehouse, (s) => statusText(s)],
  values: {
    number: (s) => s.number,
    date: (s) => Date.parse(s.postedAt || s.createdAt) || 0,
    order: (s) => s.orderNumber,
    warehouse: (s) => s.warehouse || '',
    qty: (s) => s.qty,
    status: (s) => statusText(s)
  },
  sort: { column: 'number', direction: 'descending' }
}

export default function Shipments ({ api, onChanged, onNavigate }) {
  const widths = useColumnWidths('shipments', SHIPMENT_COLUMNS)
  const { rows, error, reload } = useLoad(() => api.shipments(), [api])
  const view = useGridView(rows, SHIPMENT_GRID)
  const trail = useTrail('Shipments')

  if (trail.top) {
    return <OpenDocument trail={trail} api={api} onChanged={onChanged} onNavigate={onNavigate} onClose={reload} />
  }

  return (
    <Frame title='Shipments' error={error} loading={!rows}>
      <GridSearch placeholder='Shipment, order or warehouse' view={view} />
      <TableView {...widths.tableProps} {...view.tableProps}
        aria-label='Shipments' density='compact' overflowMode='wrap' marginTop='size-200'
        UNSAFE_className='erp-rows-open'
        selectionMode='none' onAction={(key) => trail.open('shipment', String(key))}>
        <TableHeader>
          <Column key='number' {...widths.columnProps('number')} allowsSorting>Shipment</Column>
          <Column key='date' {...widths.columnProps('date')} allowsSorting>Shipment date</Column>
          <Column key='order' {...widths.columnProps('order')} allowsSorting>Sales order</Column>
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
              <Cell>{s.warehouse || '—'}</Cell>
              <Cell>{s.qty}</Cell>
              <Cell><StatusLight variant={s.status === 'posted' ? 'positive' : 'notice'}>{statusText(s)}</StatusLight></Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
