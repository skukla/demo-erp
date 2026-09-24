/*
 * The header of a sales order document: the facts about the whole order, which an ERP
 * prints as labelled fields above the lines. SAP and Business Central both put the
 * customer, the dates and the terms here; the line items come underneath.
 *
 * Three statuses, not one: overall, shipping and billing. SAP's order header carries
 * exactly that triple, and it is what lets an order read as "confirmed, partly shipped,
 * not yet billed" instead of one word that has to mean all three.
 */
import React from 'react'
import { Grid, StatusLight, Text } from '@adobe/react-spectrum'
import Card from './Card'
import Field from './Field'
import { formatDate } from '../formatStamp'

/* How an order's status reads and what colour it wears — in ONE place, read by the list,
   the document and the customer's order card. */
const STATUS_TEXT = { created: 'Open', confirmed: 'Confirmed', shipped: 'Shipped', invoiced: 'Invoiced', cancelled: 'Cancelled' }
const LIGHT = { created: 'neutral', confirmed: 'info', shipped: 'notice', invoiced: 'positive', cancelled: 'negative' }

export function statusText (status) {
  return STATUS_TEXT[status] || status
}

/** The StatusLight variant for an order status. */
export function statusLight (status) {
  return LIGHT[status] || 'neutral'
}

const SHIPPING = { none: ['Not shipped', 'neutral'], partial: ['Partly shipped', 'notice'], full: ['Fully shipped', 'positive'] }
const BILLING = { none: ['Not invoiced', 'neutral'], invoiced: ['Invoiced', 'positive'], credited: ['Credited', 'notice'] }
const OVERALL = { Open: 'neutral', 'In process': 'info', Completed: 'positive', Cancelled: 'negative' }
/* SAP's three credit states on a document. Absent for a customer with no credit. */
const CREDIT = { approved: ['Approved', 'positive'], held: ['On credit hold', 'negative'], released: ['Released', 'info'] }

function Status ({ variant, children }) {
  return <StatusLight variant={variant} marginStart='size-0'>{children}</StatusLight>
}

export default function OrderHeader ({ order, onOpen }) {
  const partner = order.partner
  const [shippingText, shippingLight] = SHIPPING[order.shippingStatus] || SHIPPING.none
  const [billingText, billingLight] = BILLING[order.billingStatus] || BILLING.none
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

        <Field label='Sold-to'>
          {partner
            ? (onOpen
                ? <button type='button' className='erp-link' onClick={() => onOpen('customer', partner.id, partner.name)}>{`${partner.id} · ${partner.name}`}</button>
                : `${partner.id} · ${partner.name}`)
            : '—'}
        </Field>
      {/* SAP's own default: in the simplest case the customer takes every partner
          function itself. Saying so is honest and it is the field an ERP eye looks for. */}
        <Field label='Ship-to'>Same as sold-to</Field>
        <Field label='Sales organisation'>{partner ? partner.salesOrg : '—'}</Field>

        <Field label='Payment terms'>{partner ? partner.paymentTerms : '—'}</Field>
        <Field label='Currency'>{order.currency || 'USD'}</Field>
        <Field label='Overall status'><Status variant={OVERALL[order.overall] || 'neutral'}>{order.overall || statusText(order.status)}</Status></Field>

        <Field label='Shipping status'><Status variant={shippingLight}>{shippingText}</Status></Field>
        <Field label='Billing status'><Status variant={billingLight}>{billingText}</Status></Field>
        {order.credit && (
          <Field label='Credit status'>
            <Status variant={(CREDIT[order.credit.status] || CREDIT.approved)[1]}>{(CREDIT[order.credit.status] || CREDIT.approved)[0]}</Status>
            {order.credit.reason && <Text UNSAFE_className='erp-subtle'>{order.credit.reason}</Text>}
          </Field>
        )}
        {order.cancelReason && <Field label='Cancellation reason'>{order.cancelReason}</Field>}
      </Grid>
    </Card>
  )
}
