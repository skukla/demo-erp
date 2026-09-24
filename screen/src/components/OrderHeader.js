/*
 * The header of a sales order document: the facts about the whole order, which an ERP
 * prints as labelled fields above the lines. SAP and Business Central both put the
 * customer, the dates and the terms here; the line items come underneath.
 */
import React from 'react'
import { Grid, StatusLight } from '@adobe/react-spectrum'
import Card from './Card'
import Field from './Field'
import { formatDate } from '../formatStamp'

/* How an order's status reads and what colour it wears — in ONE place, read by the list,
   the document and the customer's order card. Three copies of the colour map was two
   too many. */
const STATUS_TEXT = { created: 'Open', confirmed: 'Confirmed', shipped: 'Shipped', invoiced: 'Invoiced', cancelled: 'Cancelled' }
const LIGHT = { created: 'neutral', confirmed: 'info', shipped: 'notice', invoiced: 'positive', cancelled: 'negative' }

export function statusText (status) {
  return STATUS_TEXT[status] || status
}

/** The StatusLight variant for an order status. */
export function statusLight (status) {
  return LIGHT[status] || 'neutral'
}

export default function OrderHeader ({ order }) {
  const partner = order.partner
  return (
    <Card>
      <Grid
        columns={{ base: ['1fr'], M: ['1fr', '1fr', '1fr'] }}
        gap='size-250'
      >
        <Field label='Document type'>Sales order</Field>
        <Field label='Order date'>{formatDate(order.createdAt)}</Field>
      {/* The buyer's own reference for this order, which is what Commerce's increment
          id is. Business Central heads the same field External Document No. */}
        <Field label='Customer reference'>{order.commerceIncrementId || order.commerceOrderId || '—'}</Field>

        <Field label='Sold-to'>{partner ? `${partner.id} · ${partner.name}` : '—'}</Field>
      {/* SAP's own default: in the simplest case the customer takes every partner
          function itself. Saying so is honest and it is the field an ERP eye looks for. */}
        <Field label='Ship-to'>Same as sold-to</Field>
        <Field label='Sales organisation'>{partner ? partner.salesOrg : '—'}</Field>

        <Field label='Payment terms'>{partner ? partner.paymentTerms : '—'}</Field>
        <Field label='Currency'>{order.currency || 'USD'}</Field>
        <Field label='Status'>
        <StatusLight variant={statusLight(order.status)} marginStart='size-0'>
          {statusText(order.status)}
        </StatusLight>
      </Field>

        {order.cancelReason && <Field label='Cancellation reason'>{order.cancelReason}</Field>}
      </Grid>
    </Card>
  )
}
