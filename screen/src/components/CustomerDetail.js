/*
 * One customer's document: the business-partner master, as an ERP shows it. The list
 * holds a row; this holds the account — its facts as labelled fields, its credit, its
 * own sales orders, and the pricing agreed with it.
 *
 * Credit is the card an ERP eye looks for first, and it is the one that is NOT there for
 * the walk-in account: a customer with no Commerce company has no credit relationship,
 * so the ERP answers no credit and the card is left out rather than showing a zero.
 * Exposure is worked out by the ERP on read (lib/partners describePartner), never kept.
 *
 * Blocking is a verb on the page header — Block customer / Unblock — the way the order
 * document's actions are. The list keeps its switch for quick edits while preparing a
 * demo; here you look at the account before you block it.
 */
import React, { useState } from 'react'
import {
  Grid, Item, Link, Picker, StatusLight, Text, View,
  TableView, TableHeader, Column, TableBody, Row, Cell
} from '@adobe/react-spectrum'
import Card from './Card'
import Field from './Field'
import DocumentPage from './DocumentPage'
import EditableNumber from './EditableNumber'
import { useLoad } from './useLoad'
import { toastFailed, toastSaved } from './toast'
import { statusLight, statusText } from './OrderHeader'
import { amountText, productText, ruleText } from './pricingRuleFormat'
import { formatDate } from '../formatStamp'
import { money, moneyOptions } from '../money'

const MONEY = moneyOptions()

/* Business Central's four levels, in plainer words, each saying what it stops. */
export const BLOCKING_LEVELS = [
  { id: 'open', label: 'Open', help: 'Everything allowed' },
  { id: 'shipping', label: 'Blocked for shipping', help: 'New orders arrive on credit hold; nothing new ships; existing shipments can still be invoiced' },
  { id: 'invoicing', label: 'Blocked for invoicing', help: 'New orders on hold; nothing ships; no new invoices' },
  { id: 'all', label: 'Blocked for all business', help: 'Nothing proceeds' }
]
export const blockingText = (level) => (BLOCKING_LEVELS.find((l) => l.id === level) || BLOCKING_LEVELS[0]).label

function CreditCard ({ customer, onLimit }) {
  const { credit } = customer
  // Over the limit is the one state that has to be seen from across the room.
  const over = credit.available < 0
  return (
    <Card title='Credit'>
      <Grid columns={{ base: ['1fr'], M: ['1fr', '1fr', '1fr'] }} gap='size-250'>
        <Field label='Credit limit'>
          <EditableNumber
            label='Credit limit'
            value={credit.limit}
            isSaving={customer.saving === 'creditLimit'}
            step={100}
            formatOptions={MONEY}
            onSave={onLimit}
          />
        </Field>
        <Field label='Credit exposure'>{money(credit.exposure)}</Field>
        <Field label='Available credit'>
          <Text UNSAFE_style={over ? { fontWeight: 600 } : undefined}>{money(credit.available)}</Text>
        </Field>
        <Field label='Credit status'>
          <StatusLight variant={over ? 'negative' : 'positive'} marginStart='size-0'>
            {over ? 'Over limit' : 'Within limit'}
          </StatusLight>
        </Field>
        <Field label='Blocking'>
          <StatusLight variant={customer.blocking === 'open' ? 'neutral' : 'negative'} marginStart='size-0'>
            {blockingText(customer.blocking)}
          </StatusLight>
        </Field>
        {/* SAP's work list of blocked documents, for this customer. */}
        <Field label='Orders on credit hold'>
          {credit.held > 0
            ? <StatusLight variant='negative' marginStart='size-0'>{`${credit.held} held`}</StatusLight>
            : 'None'}
        </Field>
      </Grid>
      {/* View, not a margin on Text: Spectrum's Text takes no layout props. */}
      <View marginTop='size-250'>
        <Text UNSAFE_className='erp-subtle'>
          Exposure is the net amount of this customer's sales orders not yet invoiced.
        </Text>
      </View>
    </Card>
  )
}

function OrdersCard ({ orders, onOpen }) {
  return (
    <Card title='Sales Orders'>
      {orders.length === 0
        ? <Text>No sales orders for this customer.</Text>
        : (
          <TableView
            aria-label="This customer's sales orders" density='compact' overflowMode='wrap'
            UNSAFE_className='erp-rows-open' selectionMode='none' onAction={(key) => onOpen(String(key))}
          >
            <TableHeader>
              <Column key='number' width={165}>Sales order</Column>
              <Column key='date' width={140}>Order date</Column>
              <Column key='reference' width='1fr' minWidth={150}>Reference</Column>
              <Column key='net' width={150} align='end'>Net amount</Column>
              <Column key='status' width={140}>Status</Column>
            </TableHeader>
            <TableBody items={orders.map((o) => ({ ...o, id: o.number }))}>
              {(o) => (
                <Row key={o.number}>
                  <Cell><span className='erp-key'>{o.number}</span></Cell>
                  <Cell>{formatDate(o.createdAt)}</Cell>
                  <Cell>{o.commerceIncrementId || o.commerceOrderId || '—'}</Cell>
                  <Cell>{money(o.net, o.currency)}</Cell>
                  <Cell>
                    {o.creditStatus === 'held' && o.status !== 'cancelled'
                      ? <StatusLight variant='negative'>On credit hold</StatusLight>
                      : <StatusLight variant={statusLight(o.status)}>{statusText(o.status)}</StatusLight>}
                  </Cell>
                </Row>
              )}
            </TableBody>
          </TableView>
          )}
    </Card>
  )
}

function PricingCard ({ conditions, onNavigate }) {
  return (
    <Card
      title='Pricing'
      actions={onNavigate && <Link isQuiet onPress={() => onNavigate('pricing')}>Pricing Rules →</Link>}
    >
      {conditions.length === 0
        ? <Text>No pricing rules are agreed with this customer; it pays list price.</Text>
        : (
          <TableView aria-label='Pricing rules for this customer' density='compact' overflowMode='wrap'>
            <TableHeader>
              <Column key='rule' width='1fr' minWidth={230}>Rule</Column>
              <Column key='product' width='1fr' minWidth={190}>Product</Column>
              <Column key='amount' width={150} align='end'>Amount</Column>
            </TableHeader>
            <TableBody items={conditions.map((c) => ({ ...c, id: c._id }))}>
              {(c) => (
                <Row key={c._id}>
                  <Cell>{ruleText(c.kind)}</Cell>
                  <Cell>{productText(c)}</Cell>
                  <Cell>{amountText(c)}</Cell>
                </Row>
              )}
            </TableBody>
          </TableView>
          )}
    </Card>
  )
}

/**
 * @param {object} props `id` the customer; `onOpen(kind, number)` opens one of its orders
 *   on the same trail, so Back from the order returns here.
 */
export default function CustomerDetail ({ api, id, backLabel = 'Customers', onBack, onOpen, onChanged, onNavigate }) {
  const { rows, error, reload, updateRow } = useLoad(async () => [await api.partner(id)], [api, id])
  const customer = rows && rows[0]
  const [busy, setBusy] = useState(false)

  /* An edit shows at once and settles on the ERP's answer. The answer is the customer
     record alone (PATCH answers no document), so the document is read again afterwards
     — the credit picture may have moved with the limit. */
  async function patch (change, saved) {
    const isRow = () => true
    const before = customer
    updateRow(isRow, (row) => ({ ...row, ...change, saving: Object.keys(change)[0] }))
    setBusy(true)
    try {
      await api.patchPartner(id, change)
      await reload()
      toastSaved(saved)
      onChanged()
    } catch (e) {
      updateRow(isRow, () => before)
      toastFailed(`Not saved: ${e.message}`)
    }
    setBusy(false)
  }

  return (
    <DocumentPage
      backLabel={backLabel}
      onBack={onBack}
      title={customer ? customer.name : ''}
      subtitle={customer ? `Customer ${customer.id}` : undefined}
      error={error}
      loading={!customer}
      actions={customer && customer.credit && (
        /* The blocking level is the one decision made on this document; the walk-in account
           cannot be blocked, since nothing in Commerce answers to it. */
        <Picker
          aria-label='Blocking level'
          items={BLOCKING_LEVELS}
          selectedKey={customer.blocking}
          isDisabled={busy}
          onSelectionChange={(key) => patch({ blocking: String(key) }, `Customer ${blockingText(String(key)).toLowerCase()}`)}
          width='size-3000'
        >
          {(level) => <Item key={level.id} textValue={level.label}><Text>{level.label}</Text><Text slot='description'>{level.help}</Text></Item>}
        </Picker>
      )}
    >
      {customer && (
        <>
          <Card>
            <Grid columns={{ base: ['1fr'], M: ['1fr', '1fr', '1fr'] }} gap='size-250'>
              <Field label='Customer'>{customer.id}</Field>
              <Field label='Name'>{customer.name}</Field>
              {/* SAP's partner functions: in the simplest case the customer is its own
                  sold-to, and every account here is one. Saying so is the ERP texture. */}
              <Field label='Partner type'>Sold-to</Field>
              <Field label='Commerce company'>{customer.commerceCompanyId || '—'}</Field>
              <Field label='Customer group'>{customer.customerGroupId || '—'}</Field>
              <Field label='Email domain'>{customer.emailDomain || '—'}</Field>
              <Field label='Sales organisation'>{customer.salesOrg || '—'}</Field>
              <Field label='Payment terms'>{customer.paymentTerms || '—'}</Field>
            </Grid>
          </Card>
          {customer.credit && (
            <CreditCard customer={customer} onLimit={(creditLimit) => patch({ creditLimit }, 'Credit limit saved')} />
          )}
          <OrdersCard orders={customer.orders || []} onOpen={(number) => onOpen('order', number)} />
          <PricingCard conditions={customer.conditions || []} onNavigate={onNavigate} />
        </>
      )}
    </DocumentPage>
  )
}
