/*
 * One credit memo's document: what the ERP owes back, against which invoice, and for
 * which return order when it credits one. It has no moves: a credit memo cannot be
 * undone, in the ERP as in Commerce.
 *
 * The memo carries its sales order's number; the order is read beside it for the
 * sold-to, the products' names and the currency the memo is in.
 */
import React, { useMemo } from 'react'
import { Grid } from '@adobe/react-spectrum'
import DocumentPage from './DocumentPage'
import Card from './Card'
import Field from './Field'
import Totals from './Totals'
import { useLoad } from './useLoad'
import { formatDate } from '../formatStamp'
import { money } from '../money'
import { discountTotal, withDiscountColumn } from './lineDiscount'
import { GRID_COLUMNS } from './gridColumns'
import LinesTable from './LinesTable'

const orderLineOf = (order, item) => (order.lines || []).find((l) => l.item === item) || {}

/* The line columns that print money; Discount is among them only when a line carries one. */
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
  const lineColumns = useMemo(() => withDiscountColumn(GRID_COLUMNS.creditMemoLines, memo ? memo.lines : []), [memo])
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
            <LinesTable
              tableId='creditMemoLines' label='Credit memo lines' columns={lineColumns}
              lines={memo.lines.map((l) => ({ ...l, name: orderLineOf(order, l.item).name || l.sku }))}
              cell={(line, key) => (MONEY_KEYS.has(key) ? money(line[key] || 0, currency) : line[key])}
            />
            <Totals discount={discountTotal(memo.lines)} net={memo.net} tax={memo.tax} total={memo.total} currency={currency} />
          </Card>
        </>
      )}
    </DocumentPage>
  )
}
