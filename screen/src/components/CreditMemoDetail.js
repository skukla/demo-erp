/*
 * One credit memo's document: what the ERP owes back, against which invoice, and for
 * which return order when it credits one. It has no moves: a credit memo cannot be
 * undone, in the ERP as in Commerce.
 *
 * The memo carries its sales order's number; the order is read beside it for the
 * sold-to, the products' names and the currency the memo is in.
 */
import React from 'react'
import { Grid, TableView, TableHeader, Column, TableBody, Row, Cell } from '@adobe/react-spectrum'
import DocumentPage from './DocumentPage'
import Card from './Card'
import Field from './Field'
import Totals from './Totals'
import { useLoad } from './useLoad'
import { formatDate } from '../formatStamp'
import { money } from '../money'
import { discountTotal, withDiscountColumn } from './lineDiscount'

const orderLineOf = (order, item) => (order.lines || []).find((l) => l.item === item) || {}

/* Dynamic columns: Discount is among them only when a line carries one (lineDiscount.js). */
const LINE_COLUMNS = [
  { key: 'item', label: 'Item', width: 90 },
  { key: 'sku', label: 'Product', width: 170 },
  { key: 'name', label: 'Description', width: '1fr', minWidth: 220 },
  { key: 'qty', label: 'Qty', width: 110, align: 'end' },
  { key: 'price', label: 'Net price', width: 150, align: 'end' },
  { key: 'amount', label: 'Net amount', width: 160, align: 'end' }
]
const MONEY_KEYS = new Set(['price', 'discount', 'amount'])

/** A document number that opens it; null for none, which the Field prints as a dash. */
function documentLink (kind, number, onOpen) {
  if (!number) return null
  return <button type='button' className='erp-link' onClick={() => onOpen(kind, number)}>{number}</button>
}

export default function CreditMemoDetail ({ api, number, backLabel = 'Credit Memos', onBack, onOpen }) {
  const { rows, error } = useLoad(async () => {
    const memo = await api.creditMemo(number)
    return [{ memo, order: await api.order(memo.orderNumber) }]
  }, [api, number])
  const loaded = rows && rows[0]
  const memo = loaded && loaded.memo
  const order = loaded && loaded.order
  const currency = order && order.currency
  return (
    <DocumentPage
      backLabel={backLabel}
      onBack={onBack}
      title={memo ? `Credit Memo ${memo.number}` : ''}
      subtitle={order && order.partner ? `${order.partner.id} · ${order.partner.name}` : undefined}
      error={error}
      loading={!loaded}
    >
      {loaded && (
        <>
          <Card>
            <Grid columns={{ base: ['1fr'], M: ['1fr', '1fr', '1fr'] }} gap='size-250'>
              <Field label='Document type'>Credit memo</Field>
              <Field label='Posted'>{formatDate(memo.createdAt)}</Field>
              <Field label='Credits'>{memo.returnNumber ? 'The returned lines' : 'The whole invoice'}</Field>
              <Field label='Sales order'>{documentLink('order', memo.orderNumber, onOpen)}</Field>
              <Field label='Invoice'>{documentLink('invoice', memo.invoiceNumber, onOpen)}</Field>
              <Field label='Return order'>{documentLink('return', memo.returnNumber, onOpen)}</Field>
              <Field label='Currency'>{currency || 'USD'}</Field>
            </Grid>
          </Card>
          <Card>
            {/* Keyed on the column set: the table builds its column model once. */}
            <TableView key={discountTotal(memo.lines) > 0 ? 'lines-discount' : 'lines'} aria-label='Credit memo lines' density='compact' overflowMode='wrap'>
              <TableHeader columns={withDiscountColumn(LINE_COLUMNS, memo.lines)}>
                {(c) => <Column key={c.key} width={c.width} minWidth={c.minWidth} align={c.align}>{c.label}</Column>}
              </TableHeader>
              <TableBody items={memo.lines.map((l) => ({ ...l, id: l.item, name: orderLineOf(order, l.item).name || l.sku }))}>
                {(line) => (
                  <Row key={line.item}>
                    {(key) => <Cell>{MONEY_KEYS.has(key) ? money(line[key] || 0, currency) : line[key]}</Cell>}
                  </Row>
                )}
              </TableBody>
            </TableView>
            <Totals discount={discountTotal(memo.lines)} net={memo.net} tax={memo.tax} total={memo.total} currency={currency} />
          </Card>
        </>
      )}
    </DocumentPage>
  )
}
