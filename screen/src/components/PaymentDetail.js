/*
 * One incoming payment's document: who paid, how much, against which invoice, and the
 * reference they gave. It has no moves: a payment cannot be undone in the ERP.
 */
import React from 'react'
import { Grid } from '@adobe/react-spectrum'
import DocumentPage from './DocumentPage'
import Card from './Card'
import Field from './Field'
import { useLoad } from './useLoad'
import { formatDate } from '../formatStamp'
import { money } from '../money'

/** A document number that opens it. */
function documentLink (kind, number, onOpen) {
  if (!number) return null
  return <button type='button' className='erp-link' onClick={() => onOpen(kind, number)}>{number}</button>
}

export default function PaymentDetail ({ api, number, backLabel = 'Payments', onBack, onOpen }) {
  const { rows, error } = useLoad(async () => [await api.payment(number)], [api, number])
  const payment = rows && rows[0]
  return (
    <DocumentPage
      backLabel={backLabel}
      onBack={onBack}
      title={payment ? `Payment ${payment.number}` : ''}
      subtitle={payment ? `Invoice ${payment.invoiceNumber}` : undefined}
      error={error}
      loading={!payment}
    >
      {payment && (
        <Card>
          <Grid columns={{ base: ['1fr'], M: ['1fr', '1fr', '1fr'] }} gap='size-250'>
            <Field label='Document type'>Incoming payment</Field>
            <Field label='Posted'>{formatDate(payment.createdAt)}</Field>
            <Field label='Amount'>{money(payment.amount, payment.currency)}</Field>
            <Field label='Invoice'>{documentLink('invoice', payment.invoiceNumber, onOpen)}</Field>
            <Field label='Sales order'>{documentLink('order', payment.orderNumber, onOpen)}</Field>
            <Field label='Customer'>{documentLink('customer', payment.partnerId, onOpen)}</Field>
            <Field label='Reference'>{payment.reference || '—'}</Field>
            <Field label='Currency'>{payment.currency || 'USD'}</Field>
          </Grid>
        </Card>
      )}
    </DocumentPage>
  )
}
