/*
 * Credit memos: the list. A credit memo is posted on its invoice (the whole invoice) or on
 * a received return order (its lines), so the list has no Add. Choose a row to open one.
 */
import React from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell } from '@adobe/react-spectrum'
import Frame from './Frame'
import { useLoad } from './useLoad'
import { useColumnWidths } from './columnWidths'
import { useGridView, GridSearch } from './GridView'
import { useTrail, OpenDocument, useOpenFromQuery } from './Documents'
import { formatDate } from '../formatStamp'
import { money } from '../money'

const MEMO_COLUMNS = [
  { key: 'number', width: 165 },
  { key: 'date', width: 130 },
  { key: 'order', width: 150 },
  { key: 'invoice', width: 150 },
  { key: 'return', width: 160 },
  { key: 'partner', width: '2fr', minWidth: 200 },
  { key: 'total', width: 150 }
]

const soldTo = (m) => (m.partnerName ? `${m.partnerId} · ${m.partnerName}` : (m.partnerId || '—'))

const MEMO_GRID = {
  fields: [(m) => m.number, (m) => m.orderNumber, (m) => m.invoiceNumber, (m) => m.returnNumber, (m) => m.partnerId, (m) => m.partnerName],
  values: {
    number: (m) => m.number,
    date: (m) => Date.parse(m.createdAt) || 0,
    order: (m) => m.orderNumber,
    invoice: (m) => m.invoiceNumber || '',
    return: (m) => m.returnNumber || '',
    partner: (m) => m.partnerId || '',
    total: (m) => m.total || 0
  },
  sort: { column: 'number', direction: 'descending' }
}

export default function CreditMemos ({ api, query = {}, onChanged, onNavigate }) {
  const widths = useColumnWidths('creditMemos', MEMO_COLUMNS)
  const { rows, error, reload } = useLoad(() => api.creditMemos(), [api])
  const view = useGridView(rows, MEMO_GRID)
  const trail = useTrail('Credit Memos')
  useOpenFromQuery(trail, query, 'creditMemo')

  if (trail.top) {
    return <OpenDocument trail={trail} api={api} onChanged={onChanged} onNavigate={onNavigate} onClose={reload} />
  }

  return (
    <Frame title='Credit Memos' error={error} loading={!rows}>
      <GridSearch placeholder='Credit memo, order, invoice, return or customer' view={view} />
      <TableView {...widths.tableProps} {...view.tableProps}
        aria-label='Credit memos' density='compact' overflowMode='wrap' marginTop='size-200'
        UNSAFE_className='erp-rows-open'
        selectionMode='none' onAction={(key) => trail.open('creditMemo', String(key))}>
        <TableHeader>
          <Column key='number' {...widths.columnProps('number')} allowsSorting>Credit memo</Column>
          <Column key='date' {...widths.columnProps('date')} allowsSorting>Posted</Column>
          <Column key='order' {...widths.columnProps('order')} allowsSorting>Sales order</Column>
          <Column key='invoice' {...widths.columnProps('invoice')} allowsSorting>Invoice</Column>
          <Column key='return' {...widths.columnProps('return')} allowsSorting>Return order</Column>
          <Column key='partner' {...widths.columnProps('partner')} allowsSorting>Sold-to</Column>
          <Column key='total' {...widths.columnProps('total')} align='end' allowsSorting>Total</Column>
        </TableHeader>
        <TableBody items={view.items}>
          {(m) => (
            <Row key={m.number}>
              <Cell><span className='erp-key'>{m.number}</span></Cell>
              <Cell>{formatDate(m.createdAt)}</Cell>
              <Cell>{m.orderNumber}</Cell>
              <Cell>{m.invoiceNumber || '—'}</Cell>
              <Cell>{m.returnNumber || '—'}</Cell>
              <Cell>{soldTo(m)}</Cell>
              <Cell>{money(m.total, m.currency)}</Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
