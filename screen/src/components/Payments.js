/*
 * Payments: the list of incoming payments. A payment is posted on its invoice, so the list
 * has no Add — it is where an SC finds what a customer paid. Choose a row to open one.
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
import { paymentReferenceText } from './paymentFormat'

const PAYMENT_COLUMNS = [
  { key: 'number', width: 165 },
  { key: 'date', width: 130 },
  { key: 'invoice', width: 150 },
  { key: 'order', width: 150 },
  { key: 'partner', width: '2fr', minWidth: 200 },
  { key: 'reference', width: '1fr', minWidth: 150 },
  { key: 'amount', width: 150 }
]

const soldTo = (p) => (p.partnerName ? `${p.partnerId} · ${p.partnerName}` : (p.partnerId || '—'))

const PAYMENT_GRID = {
  fields: [(p) => p.number, (p) => p.invoiceNumber, (p) => p.orderNumber, (p) => p.partnerId, (p) => p.partnerName, paymentReferenceText],
  values: {
    number: (p) => p.number,
    date: (p) => Date.parse(p.createdAt) || 0,
    invoice: (p) => p.invoiceNumber,
    order: (p) => p.orderNumber,
    partner: (p) => p.partnerId || '',
    reference: (p) => p.reference || '',
    amount: (p) => p.amount || 0
  },
  sort: { column: 'number', direction: 'descending' }
}

export default function Payments ({ api, query = {}, onChanged, onNavigate }) {
  const widths = useColumnWidths('payments', PAYMENT_COLUMNS)
  const { rows, error, reload } = useLoad(() => api.payments(), [api])
  const view = useGridView(rows, PAYMENT_GRID)
  const trail = useTrail('Payments')
  useOpenFromQuery(trail, query, 'payment')

  if (trail.top) {
    return <OpenDocument trail={trail} api={api} onChanged={onChanged} onNavigate={onNavigate} onClose={reload} />
  }

  return (
    <Frame title='Payments' error={error} loading={!rows}>
      <GridSearch placeholder='Payment, invoice, order, customer or reference' view={view} />
      <TableView {...widths.tableProps} {...view.tableProps}
        aria-label='Payments' density='compact' overflowMode='wrap' marginTop='size-200'
        UNSAFE_className='erp-rows-open'
        selectionMode='none' onAction={(key) => trail.open('payment', String(key))}>
        <TableHeader>
          <Column key='number' {...widths.columnProps('number')} allowsSorting>Payment</Column>
          <Column key='date' {...widths.columnProps('date')} allowsSorting>Posted</Column>
          <Column key='invoice' {...widths.columnProps('invoice')} allowsSorting>Invoice</Column>
          <Column key='order' {...widths.columnProps('order')} allowsSorting>Sales order</Column>
          <Column key='partner' {...widths.columnProps('partner')} allowsSorting>Sold-to</Column>
          <Column key='reference' {...widths.columnProps('reference')} allowsSorting>Reference</Column>
          <Column key='amount' {...widths.columnProps('amount')} align='end' allowsSorting>Amount</Column>
        </TableHeader>
        <TableBody items={view.items}>
          {(p) => (
            <Row key={p.number}>
              <Cell><span className='erp-key'>{p.number}</span></Cell>
              <Cell>{formatDate(p.createdAt)}</Cell>
              <Cell>{p.invoiceNumber}</Cell>
              <Cell>{p.orderNumber}</Cell>
              <Cell>{soldTo(p)}</Cell>
              <Cell>{paymentReferenceText(p)}</Cell>
              <Cell>{money(p.amount, p.currency)}</Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
