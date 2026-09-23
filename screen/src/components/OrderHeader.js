/*
 * The header of a sales order document: the facts about the whole order, which an ERP
 * prints as labelled fields above the lines. SAP and Business Central both put the
 * customer, the dates and the terms here; the line items come underneath.
 */
import React from 'react'
import { Grid, Flex, Text, StatusLight } from '@adobe/react-spectrum'
import { formatDate } from '../formatStamp'

const LABEL_STYLE = { color: 'var(--spectrum-global-color-gray-700)', fontSize: '12px' }

/** One labelled fact. An absent value reads as a dash, never as an empty gap. */
function Field ({ label, children }) {
  // alignItems start, not the default stretch: a status badge is as wide as its word,
  // and a flex column would otherwise pull it across the whole field.
  return (
    <Flex direction='column' gap='size-25' alignItems='start'>
      <Text UNSAFE_style={LABEL_STYLE}>{label}</Text>
      {typeof children === 'string' || typeof children === 'number'
        ? <Text>{children}</Text>
        : (children || <Text>—</Text>)}
    </Flex>
  )
}

const STATUS_TEXT = { created: 'Open', confirmed: 'Confirmed', shipped: 'Shipped', invoiced: 'Invoiced', cancelled: 'Cancelled' }
const LIGHT = { created: 'neutral', confirmed: 'info', shipped: 'notice', invoiced: 'positive', cancelled: 'negative' }

export function statusText (status) {
  return STATUS_TEXT[status] || status
}

export default function OrderHeader ({ order }) {
  const partner = order.partner
  return (
    <Grid
      columns={{ base: ['1fr'], M: ['1fr', '1fr', '1fr'] }}
      gap='size-250'
      marginBottom='size-300'
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
        <StatusLight variant={LIGHT[order.status] || 'neutral'} marginStart='size-0'>
          {statusText(order.status)}
        </StatusLight>
      </Field>

      {order.cancelReason && <Field label='Cancellation reason'>{order.cancelReason}</Field>}
    </Grid>
  )
}
