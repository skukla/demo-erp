/*
 * One invoice's document: the whole order, billed once. Bill-to is the sold-to, as
 * ship-to is on the order — SAP's simplest case, and the honest one here.
 *
 * No action yet. A credit memo against it is the next document (plan slice 5), and
 * until it exists the invoice says so rather than offering a button that does nothing.
 */
import React from 'react'
import { Grid, StatusLight, TableView, TableHeader, Column, TableBody, Row, Cell } from '@adobe/react-spectrum'
import DocumentPage from './DocumentPage'
import Card from './Card'
import Field from './Field'
import Totals from './Totals'
import { useLoad } from './useLoad'
import { formatDate } from '../formatStamp'
import { money } from '../money'

export default function InvoiceDetail ({ api, number, backLabel = 'Invoices', onBack, onOpen }) {
  const { rows, error } = useLoad(async () => [await api.invoice(number)], [api, number])
  const invoice = rows && rows[0]
  const credited = invoice && invoice.status === 'credited'
  return (
    <DocumentPage
      backLabel={backLabel}
      onBack={onBack}
      title={invoice ? `Invoice ${invoice.number}` : ''}
      subtitle={invoice ? `Sales order ${invoice.orderNumber}` : undefined}
      error={error}
      loading={!invoice}
    >
      {invoice && (
        <>
          <Card>
            <Grid columns={{ base: ['1fr'], M: ['1fr', '1fr', '1fr'] }} gap='size-250'>
              <Field label='Document type'>Invoice</Field>
              <Field label='Billing date'>{formatDate(invoice.createdAt)}</Field>
              <Field label='Status'>
                <StatusLight variant={credited ? 'notice' : 'positive'} marginStart='size-0'>{credited ? 'Credited' : 'Open'}</StatusLight>
              </Field>
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
              <Field label='Customer reference'>{invoice.commerceIncrementId || '—'}</Field>
              <Field label='Bill-to'>{invoice.partner ? `${invoice.partner.id} · ${invoice.partner.name}` : 'Same as sold-to'}</Field>
              <Field label='Payment terms'>{invoice.partner ? invoice.partner.paymentTerms : '—'}</Field>
              <Field label='Currency'>{invoice.currency || 'USD'}</Field>
            </Grid>
          </Card>
          {/* Who is invoicing: the company code and the sales organisation the order came
              through (a real invoice carries the seller; the structure mirror supplies it). */}
          {invoice.seller && (
            <Card title='Seller'>
              <Grid columns={{ base: ['1fr'], M: ['1fr', '1fr', '1fr'] }} gap='size-250'>
                <Field label='Company code'>{`${invoice.seller.companyCode} · ${invoice.seller.name}`}</Field>
                <Field label='Sales organisation'>{invoice.seller.salesOrg ? `${invoice.seller.salesOrg}${invoice.seller.salesOrgName ? ` · ${invoice.seller.salesOrgName}` : ''}` : '—'}</Field>
                <Field label='Country'>{invoice.seller.countryId || '—'}</Field>
                <Field label='VAT number'>{invoice.seller.vatNumber || '—'}</Field>
              </Grid>
            </Card>
          )}
          <Card>
            <TableView aria-label='Invoice lines' density='compact' overflowMode='wrap'>
              <TableHeader>
                <Column key='item' width={90}>Item</Column>
                <Column key='sku' width={170}>Product</Column>
                <Column key='name' width='1fr' minWidth={220}>Description</Column>
                <Column key='qty' width={110} align='end'>Qty</Column>
                <Column key='unit' width={110}>Base unit</Column>
                <Column key='price' width={150} align='end'>Net price</Column>
                <Column key='amount' width={160} align='end'>Net amount</Column>
              </TableHeader>
              <TableBody items={invoice.lines.map((l) => ({ ...l, id: l.item }))}>
                {(line) => (
                  <Row key={line.item}>
                    <Cell>{line.item}</Cell>
                    <Cell>{line.sku}</Cell>
                    <Cell>{line.name}</Cell>
                    <Cell>{line.qty}</Cell>
                    <Cell>{line.unit}</Cell>
                    <Cell>{money(line.price, invoice.currency)}</Cell>
                    <Cell>{money(line.amount, invoice.currency)}</Cell>
                  </Row>
                )}
              </TableBody>
            </TableView>
            <Totals net={invoice.net} tax={invoice.tax} total={invoice.total} currency={invoice.currency} />
          </Card>
        </>
      )}
    </DocumentPage>
  )
}
