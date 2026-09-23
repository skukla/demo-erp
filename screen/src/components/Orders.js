/*
 * Sales orders: the list. Search by number, by the Commerce order it came from, or
 * by customer; sort any column.
 *
 * The "Move to" buttons in each row are on borrowed time. An ERP acts on an order
 * from the order's own document, not from a row in a list, and a grid that changes
 * records is the most prototype-looking thing on this screen. They stay only until
 * the order document exists to carry them.
 */
import React, { useState } from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, ActionGroup, Item, StatusLight } from '@adobe/react-spectrum'
import Frame from './Frame'
import { useLoad } from './useLoad'
import { useColumnWidths } from './columnWidths'
import { useGridView, GridSearch } from './GridView'
import { formatDate } from '../formatStamp'

const NEXT = { created: ['confirmed', 'cancelled'], confirmed: ['shipped', 'cancelled'], shipped: ['invoiced'], invoiced: [], cancelled: [] }
const LIGHT = { created: 'neutral', confirmed: 'info', shipped: 'notice', invoiced: 'positive', cancelled: 'negative' }
/* An ERP names a status; it does not print the value it stores. "Open" is the word
   both SAP and Business Central use for an order that has not been acted on yet. */
const STATUS_TEXT = { created: 'Open', confirmed: 'Confirmed', shipped: 'Shipped', invoiced: 'Invoiced', cancelled: 'Cancelled' }
const statusText = (status) => STATUS_TEXT[status] || status

const money = (o) => new Intl.NumberFormat(undefined, { style: 'currency', currency: o.currency || 'USD' }).format(o.total || 0)
/* Business Central calls this the External Document No.; it is the customer's own
   reference for the order, which is exactly what the Commerce increment id is. */
const reference = (o) => o.commerceIncrementId || o.commerceOrderId || '—'

const ORDER_COLUMNS = [
  { key: 'number', width: 140 },
  { key: 'date', width: 130 },
  { key: 'reference', width: 150 },
  { key: 'partner', width: 120 },
  { key: 'lines', width: 80 },
  { key: 'total', width: 130 },
  { key: 'status', width: 130 },
  { key: 'actions' }
]

const ORDER_GRID = {
  fields: [(o) => o.number, (o) => reference(o), (o) => o.partnerId, (o) => statusText(o.status)],
  values: {
    number: (o) => o.number,
    date: (o) => Date.parse(o.createdAt) || 0,
    reference: (o) => reference(o),
    partner: (o) => o.partnerId || '',
    lines: (o) => (o.lines || []).length,
    total: (o) => o.total || 0,
    status: (o) => statusText(o.status)
  },
  sort: { column: 'number', direction: 'descending' }
}

export default function Orders ({ api, onChanged }) {
  const widths = useColumnWidths('orders', ORDER_COLUMNS)
  const { rows, error, reload } = useLoad(() => api.orders(), [api])
  const view = useGridView(rows, ORDER_GRID)
  const [moveError, setMoveError] = useState(null)
  async function move (number, status) {
    try { await api.moveOrder(number, status); setMoveError(null); await reload(); onChanged() } catch (e) { setMoveError(e) }
  }
  return (
    <Frame title='Sales orders' error={moveError || error} loading={!rows}>
      <GridSearch placeholder='Order, reference or customer' view={view} />
      <TableView {...widths.tableProps} {...view.tableProps} aria-label='Sales orders' density='compact' overflowMode='wrap' marginTop='size-200'>
        <TableHeader>
          <Column key='number' {...widths.columnProps('number')} allowsSorting>Sales order</Column>
          <Column key='date' {...widths.columnProps('date')} allowsSorting>Order date</Column>
          <Column key='reference' {...widths.columnProps('reference')} allowsSorting>Customer reference</Column>
          <Column key='partner' {...widths.columnProps('partner')} allowsSorting>Sold-to</Column>
          <Column key='lines' {...widths.columnProps('lines')} align='end' allowsSorting>Lines</Column>
          <Column key='total' {...widths.columnProps('total')} align='end' allowsSorting>Net amount</Column>
          <Column key='status' {...widths.columnProps('status')} allowsSorting>Status</Column>
          <Column key='actions' {...widths.columnProps('actions')}>Move to</Column>
        </TableHeader>
        <TableBody items={view.items}>
          {(o) => (
            <Row key={o.number}>
              <Cell>{o.number}</Cell>
              <Cell>{formatDate(o.createdAt)}</Cell>
              <Cell>{reference(o)}</Cell>
              <Cell>{o.partnerId || '—'}</Cell>
              <Cell>{(o.lines || []).length}</Cell>
              <Cell>{money(o)}</Cell>
              <Cell><StatusLight variant={LIGHT[o.status] || 'neutral'}>{statusText(o.status)}</StatusLight></Cell>
              <Cell>
                {(NEXT[o.status] || []).length > 0 && (
                  <ActionGroup density='compact' onAction={(key) => move(o.number, String(key))}>
                    {(NEXT[o.status] || []).map((s) => <Item key={s}>{statusText(s)}</Item>)}
                  </ActionGroup>
                )}
              </Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
