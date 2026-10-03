/*
 * A customer's open items (contract version 14, lib/partners openItemsOf): the invoices it
 * has not yet paid, oldest first, each with its due date by the customer's payment terms and
 * what is still open on it. With the open orders above, they make up the credit exposure,
 * so the figure on the Credit card has the lists under it that add up to it. A row opens
 * the invoice, where the payment is posted.
 */
import React from 'react'
import { StatusLight, Text, TableView, TableHeader, Column, TableBody, Row, Cell } from '@adobe/react-spectrum'
import Card from './Card'
import { paymentStatusText, paymentStatusLight } from './paymentFormat'
import { formatDate } from '../formatStamp'
import { money } from '../money'
import { useColumnWidths } from './columnWidths'
import { GRID_COLUMNS } from './gridColumns'

/** "2 open items · USD 1,040.00 — invoiced, not yet paid." */
function summary (items) {
  const amount = items.reduce((sum, i) => sum + (i.openAmount || 0), 0)
  return `${items.length} open ${items.length === 1 ? 'item' : 'items'} · ${money(amount, items[0].currency)} — invoiced, not yet paid.`
}

export default function OpenItemsCard ({ items, onOpen }) {
  const widths = useColumnWidths('openItems', GRID_COLUMNS.openItems)
  return (
    <Card title='Open items'>
      {items.length === 0
        ? <Text>No open items: every invoice of this customer is paid or credited.</Text>
        : (
          <>
            <Text UNSAFE_className='erp-subtle'>{summary(items)}</Text>
            <TableView {...widths.tableProps}
              aria-label="This customer's open items" density='compact' overflowMode='wrap'
              UNSAFE_className='erp-rows-open' selectionMode='none' onAction={(key) => onOpen(String(key))}
            >
              <TableHeader>
                <Column key='number' {...widths.columnProps('number')}>Invoice</Column>
                <Column key='date' {...widths.columnProps('date')}>Billing date</Column>
                <Column key='due' {...widths.columnProps('due')}>Due date</Column>
                <Column key='order' {...widths.columnProps('order')}>Sales order</Column>
                <Column key='total' {...widths.columnProps('total')} align='end'>Total</Column>
                <Column key='open' {...widths.columnProps('open')} align='end'>Open amount</Column>
                <Column key='status' {...widths.columnProps('status')}>Payment status</Column>
              </TableHeader>
              <TableBody items={items.map((i) => ({ ...i, id: i.invoiceNumber }))}>
                {(i) => (
                  <Row key={i.invoiceNumber}>
                    <Cell><span className='erp-key'>{i.invoiceNumber}</span></Cell>
                    <Cell>{formatDate(i.createdAt)}</Cell>
                    <Cell>{i.dueDate ? formatDate(i.dueDate) : '—'}</Cell>
                    <Cell>{i.orderNumber}</Cell>
                    <Cell>{money(i.total, i.currency)}</Cell>
                    <Cell>{money(i.openAmount, i.currency)}</Cell>
                    <Cell><StatusLight variant={paymentStatusLight(i)}>{paymentStatusText(i)}</StatusLight></Cell>
                  </Row>
                )}
              </TableBody>
            </TableView>
          </>
          )}
    </Card>
  )
}
