/*
 * Invoices: the list. One per invoiced order; choose a row to open the invoice. An
 * invoice raised in Commerce before the ERP kept invoice documents has no number here
 * and cannot be opened; it is listed so the count is honest.
 */
import React from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, StatusLight } from '@adobe/react-spectrum'
import Frame from './Frame'
import { useLoad } from './useLoad'
import { useColumnWidths } from './columnWidths'
import { useGridView, GridSearch } from './GridView'
import { useTrail, OpenDocument, useOpenFromQuery } from './Documents'
import { formatDate } from '../formatStamp'
import { money } from '../money'

const INVOICE_COLUMNS = [
  { key: 'number', width: 165 },
  { key: 'date', width: 140 },
  { key: 'order', width: '1fr', minWidth: 170 },
  { key: 'total', width: 150 },
  { key: 'status', width: 130 }
]

const statusText = (i) => (i.status === 'credited' ? 'Credited' : 'Open')

const INVOICE_GRID = {
  fields: [(i) => i.number, (i) => i.orderNumber, (i) => statusText(i)],
  values: {
    number: (i) => i.number || '',
    date: (i) => Date.parse(i.createdAt) || 0,
    order: (i) => i.orderNumber,
    total: (i) => i.total || 0,
    status: (i) => statusText(i)
  },
  sort: { column: 'number', direction: 'descending' }
}

export default function Invoices ({ api, query = {}, onChanged, onNavigate }) {
  const widths = useColumnWidths('invoices', INVOICE_COLUMNS)
  const { rows, error, reload } = useLoad(() => api.invoices(), [api])
  const view = useGridView(rows, INVOICE_GRID)
  const trail = useTrail('Invoices')
  useOpenFromQuery(trail, query, 'invoice')

  if (trail.top) {
    return <OpenDocument trail={trail} api={api} onChanged={onChanged} onNavigate={onNavigate} onClose={reload} />
  }

  return (
    <Frame title='Invoices' error={error} loading={!rows}>
      <GridSearch placeholder='Invoice or order' view={view} />
      <TableView {...widths.tableProps} {...view.tableProps}
        aria-label='Invoices' density='compact' overflowMode='wrap' marginTop='size-200'
        UNSAFE_className='erp-rows-open'
        selectionMode='none' onAction={(key) => { if (!String(key).startsWith('legacy:')) trail.open('invoice', String(key)) }}>
        <TableHeader>
          <Column key='number' {...widths.columnProps('number')} allowsSorting>Invoice</Column>
          <Column key='date' {...widths.columnProps('date')} allowsSorting>Billing date</Column>
          <Column key='order' {...widths.columnProps('order')} allowsSorting>Sales order</Column>
          <Column key='total' {...widths.columnProps('total')} align='end' allowsSorting>Total</Column>
          <Column key='status' {...widths.columnProps('status')} allowsSorting>Status</Column>
        </TableHeader>
        <TableBody items={view.items.map((i) => ({ ...i, id: i.number || `legacy:${i.orderNumber}` }))}>
          {(i) => (
            <Row key={i.id}>
              <Cell>{i.number ? <span className='erp-key'>{i.number}</span> : 'Invoiced in Commerce'}</Cell>
              <Cell>{formatDate(i.createdAt)}</Cell>
              <Cell>{i.orderNumber}</Cell>
              <Cell>{money(i.total, i.currency)}</Cell>
              <Cell><StatusLight variant={i.status === 'credited' ? 'notice' : 'positive'}>{statusText(i)}</StatusLight></Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
