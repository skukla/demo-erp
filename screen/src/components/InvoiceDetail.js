/*
 * One invoice's document: the whole order, billed once. Bill-to is the sold-to, as
 * ship-to is on the order — SAP's simplest case, and the honest one here.
 *
 * It is an open item until it is paid (contract version 14): the page shows what is still
 * open and offers Post payment while anything is, the amount editable for a partial
 * payment; its payments are listed among its related documents.
 *
 * Its other move is Post credit memo: the whole invoice, once (contract version 13). The
 * ERP refuses it in words when a return order is open on the invoice or has credited
 * part of it, and the page shows that refusal as it stands. Credited, the invoice offers
 * no credit and names the credit memo that credited it.
 */
import React, { useMemo } from 'react'
import { Grid, StatusLight, Text, View } from '@adobe/react-spectrum'
import DocumentPage from './DocumentPage'
import Card from './Card'
import Field from './Field'
import Totals from './Totals'
import PostCreditMemo from './PostCreditMemo'
import PostPayment from './PostPayment'
import { Box } from './RelatedDocuments'
import { useLoad } from './useLoad'
import { useDocumentAction } from './useDocumentAction'
import { paymentStatusText, paymentStatusLight, paidAtCheckoutText } from './paymentFormat'
import { canCreditInvoice, canPayInvoice } from '../../../lib/return-moves'
import { formatDate } from '../formatStamp'
import { money } from '../money'
import { addressLines } from './setupFormat'
import { discountTotal, withDiscountColumn } from './lineDiscount'
import { GRID_COLUMNS } from './gridColumns'
import LinesTable from './LinesTable'

/* The line columns that print money; Discount is among them only when a line carries one. */
const MONEY_KEYS = new Set(['price', 'discount', 'amount'])

/** The invoice's related documents: its sales order and the payments against it (a credit memo is named in the header). */
function InvoiceDocuments ({ invoice, payments, onOpen }) {
  return (
    <Card title='Related Documents'>
      <div className='erp-doc-flow'>
        <Box kind='Sales order' number={invoice.orderNumber} when={invoice.purchaseOrderByCustomer ? `Ref ${invoice.purchaseOrderByCustomer}` : ''} status='Invoiced' variant='info' onOpen={() => onOpen('order', invoice.orderNumber)} />
        {payments.map((p) => (
          <Box
            key={p.number}
            kind='Payment'
            number={p.number}
            when={formatDate(p.createdAt)}
            note={money(p.amount, p.currency)}
            status='Posted'
            variant='positive'
            onOpen={() => onOpen('payment', p.number)}
          />
        ))}
      </div>
      {payments.length === 0 && <Text>No payment yet.</Text>}
    </Card>
  )
}

export default function InvoiceDetail ({ api, number, backLabel = 'Invoices', onBack, onOpen, onChanged }) {
  const { rows, error, reload } = useLoad(async () => {
    const found = await api.invoice(number)
    // The invoice names its payments by number (contract version 14); each is read for its date and amount.
    return [{ ...found, paymentDocuments: await Promise.all((found.payments || []).map((n) => api.payment(n))) }]
  }, [api, number])
  const invoice = rows && rows[0]
  const lineColumns = useMemo(() => withDiscountColumn(GRID_COLUMNS.invoiceLines, invoice ? invoice.lines : []), [invoice])
  const credited = invoice && invoice.status === 'credited'
  const { act, busy, error: actionError } = useDocumentAction(reload, onChanged)
  return (
    <DocumentPage
      backLabel={backLabel}
      onBack={onBack}
      title={invoice ? `Invoice ${invoice.number}` : ''}
      subtitle={invoice ? `Sales order ${invoice.orderNumber}` : undefined}
      error={actionError || error}
      loading={!invoice}
      actions={invoice && (canPayInvoice(invoice) || canCreditInvoice(invoice)) && (
        <>
          {canPayInvoice(invoice) && (
            <PostPayment openAmount={invoice.openAmount} currency={invoice.currency} isDisabled={busy} onPost={(body) => act(() => api.postPayment(invoice.number, body), 'Payment posted')} />
          )}
          {canCreditInvoice(invoice) && (
            <PostCreditMemo what='this invoice in full' isDisabled={busy} onPost={() => act(() => api.creditInvoice(invoice.orderNumber), 'Credit memo posted')} />
          )}
        </>
      )}
    >
      {invoice && (
        <>
          <Card>
            <Grid columns={{ base: ['1fr'], M: ['1fr', '1fr', '1fr'] }} gap='size-250'>
              <Field label='Document type'>Invoice</Field>
              <Field label='Billing date'>{formatDate(invoice.createdAt)}</Field>
              <Field label='Payment status'>
                <StatusLight variant={paymentStatusLight(invoice)} marginStart='size-0'>{paymentStatusText(invoice)}</StatusLight>
              </Field>
              {/* What is still owed on it: the total, less payments and credits (lib/open-items). */}
              <Field label='Open amount'>{invoice.openAmount === undefined ? '—' : money(invoice.openAmount, invoice.currency)}</Field>
              <Field label='Paid'>{money(invoice.paidAmount || 0, invoice.currency)}</Field>
              <Field label='Sales order'>
                <button type='button' className='erp-link' onClick={() => onOpen('order', invoice.orderNumber)}>{invoice.orderNumber}</button>
              </Field>
              <Field label='Shipments'>
                {invoice.shipments && invoice.shipments.length > 0
                  ? (
                    <span className='erp-links'>
                      {invoice.shipments.map((s) => (
                        <button key={s} type='button' className='erp-link' onClick={() => onOpen('shipment', s)}>{s}</button>
                      ))}
                    </span>
                    )
                  : '—'}
              </Field>
              <Field label='Customer reference'>{invoice.purchaseOrderByCustomer || '—'}</Field>
              <Field label='Bill-to'>{invoice.partner ? `${invoice.partner.id} · ${invoice.partner.name}` : 'Same as sold-to'}</Field>
              <Field label='Payment terms'>{invoice.partner ? invoice.partner.paymentTerms : '—'}</Field>
              {/* Billing date plus the terms (lib/terms): what both reference systems print
                  and ours had both inputs for. Terms naming no days leave it a dash. */}
              <Field label='Due date'>{invoice.dueDate ? `${formatDate(invoice.dueDate)}${invoice.paymentDays ? ` · ${invoice.paymentDays} days` : ''}` : '—'}</Field>
              <Field label='Currency'>{invoice.currency || 'USD'}</Field>
              {/* Its order was paid at checkout (contract version 18). */}
              {invoice.payment && <Field label='Payment'>{paidAtCheckoutText(invoice.payment)}</Field>}
            </Grid>
            {credited && invoice.creditMemo && (
              <View marginTop='size-200'>
                <Text>Credited by credit memo </Text>
                <button type='button' className='erp-link' onClick={() => onOpen('creditMemo', invoice.creditMemo)}>{invoice.creditMemo}</button>
              </View>
            )}
          </Card>
          {/* Who is invoicing: the company as Settings holds it (code, name, address, tax ID)
              and the sales organization the order came through. */}
          {invoice.seller && (
            <Card title='Seller'>
              <Grid columns={{ base: ['1fr'], M: ['1fr', '1fr', '1fr'] }} gap='size-250'>
                <Field label='Company code'>{`${invoice.seller.companyCode} · ${invoice.seller.name}`}</Field>
                <Field label='Sales organization'>{invoice.seller.salesOrg ? `${invoice.seller.salesOrg}${invoice.seller.salesOrgName ? ` · ${invoice.seller.salesOrgName}` : ''}` : '—'}</Field>
                <Field label='Country'>{invoice.seller.countryId || '—'}</Field>
                <Field label='VAT number'>{invoice.seller.vatNumber || '—'}</Field>
                <Field label='Address'>{addressLines(invoice.seller.address).join(', ') || '—'}</Field>
              </Grid>
            </Card>
          )}
          <Card>
            <LinesTable
              tableId='invoiceLines' label='Invoice lines' columns={lineColumns} lines={invoice.lines}
              cell={(line, key) => (MONEY_KEYS.has(key) ? money(line[key] || 0, invoice.currency) : line[key])}
            />
            <Totals discount={discountTotal(invoice.lines)} net={invoice.net} tax={invoice.tax} total={invoice.total} currency={invoice.currency} />
          </Card>
          <InvoiceDocuments invoice={invoice} payments={invoice.paymentDocuments} onOpen={onOpen} />
        </>
      )}
    </DocumentPage>
  )
}
