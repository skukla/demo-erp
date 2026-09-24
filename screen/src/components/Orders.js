/*
 * Sales orders: the list. Search by number, by the Commerce order it came from, or by
 * customer; sort any column; choose a row to open the order's document.
 *
 * The list does not act on orders. It used to carry a "Move to" button group in every
 * row, which is the most prototype-looking thing a screen can do — an ERP acts on an
 * order from the order's own document, where you can see what you are about to change.
 * The buttons moved there when the document arrived.
 */
import React from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, StatusLight } from '@adobe/react-spectrum'
import Frame from './Frame'
import { useTrail, OpenDocument } from './Documents'
import { useLoad } from './useLoad'
import { useColumnWidths } from './columnWidths'
import { useGridView, GridSearch } from './GridView'
import { formatDate } from '../formatStamp'
import { money } from '../money'
import { statusLight, statusText } from './OrderHeader'

/* Business Central calls this the External Document No.; it is the customer's own
   reference for the order, which is exactly what the Commerce increment id is. */
const reference = (o) => o.commerceIncrementId || o.commerceOrderId || '—'

/* Each sortable header carries a chevron, which eats about 24px of its width: a
   column sized to its title alone truncates the title. */
/* Sold-to now carries an id AND a name, so it takes twice the slack of Reference. */
const ORDER_COLUMNS = [
  { key: 'number', width: 165 },
  { key: 'date', width: 140 },
  { key: 'reference', width: '1fr', minWidth: 150 },
  { key: 'partner', width: '2fr', minWidth: 230 },
  { key: 'lines', width: 80 },
  { key: 'total', width: 130 },
  { key: 'status', width: 140 }
]

const ORDER_GRID = {
  fields: [(o) => o.number, (o) => reference(o), (o) => o.partnerId, (o) => o.partnerName, (o) => statusText(o.status)],
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

export default function Orders ({ api, onChanged, onNavigate }) {
  const widths = useColumnWidths('orders', ORDER_COLUMNS)
  const { rows, error, reload } = useLoad(() => api.orders(), [api])
  const view = useGridView(rows, ORDER_GRID)
  // The documents opened from the list: the order, then whatever it opens (Documents.js).
  const trail = useTrail('Sales Orders')

  if (trail.top) {
    return <OpenDocument trail={trail} api={api} onChanged={onChanged} onNavigate={onNavigate} onClose={reload} />
  }

  return (
    <Frame title='Sales Orders' error={error} loading={!rows}>
      <GridSearch placeholder='Order, reference or customer' view={view} />
      <TableView {...widths.tableProps} {...view.tableProps}
        aria-label='Sales Orders' density='compact' overflowMode='wrap' marginTop='size-200'
        UNSAFE_className='erp-rows-open'
        selectionMode='none' onAction={(key) => trail.open('order', String(key))}>
        <TableHeader>
          <Column key='number' {...widths.columnProps('number')} allowsSorting>Sales order</Column>
          <Column key='date' {...widths.columnProps('date')} allowsSorting>Order date</Column>
          {/* "Reference", not "Customer reference": the full phrase plus its sort
              chevron does not fit beside the Move to buttons, and the reference()
              comment above says what it is. Business Central heads the same field
              External Document No., which is longer still. */}
          <Column key='reference' {...widths.columnProps('reference')} allowsSorting>Reference</Column>
          <Column key='partner' {...widths.columnProps('partner')} allowsSorting>Sold-to</Column>
          <Column key='lines' {...widths.columnProps('lines')} align='end' allowsSorting>Lines</Column>
          <Column key='total' {...widths.columnProps('total')} align='end' allowsSorting>Net amount</Column>
          <Column key='status' {...widths.columnProps('status')} allowsSorting>Status</Column>
        </TableHeader>
        <TableBody items={view.items}>
          {(o) => (
            <Row key={o.number}>
              <Cell><span className='erp-key'>{o.number}</span></Cell>
              <Cell>{formatDate(o.createdAt)}</Cell>
              <Cell>{reference(o)}</Cell>
              <Cell>{o.partnerName ? `${o.partnerId} · ${o.partnerName}` : (o.partnerId || '—')}</Cell>
              <Cell>{(o.lines || []).length}</Cell>
              <Cell>{money(o.total, o.currency)}</Cell>
              <Cell><StatusLight variant={statusLight(o.status)}>{statusText(o.status)}</StatusLight></Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
