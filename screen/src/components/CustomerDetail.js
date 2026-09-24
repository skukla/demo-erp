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
  ActionButton, Button, Content, Grid, Heading, InlineAlert, Link, StatusLight, Text, View,
  TableView, TableHeader, Column, TableBody, Row, Cell
} from '@adobe/react-spectrum'
import ChevronLeft from '@spectrum-icons/workflow/ChevronLeft'
import Card from './Card'
import Field from './Field'
import EditableNumber from './EditableNumber'
import OrderDetail from './OrderDetail'
import PageLoading from './PageLoading'
import { useLoad } from './useLoad'
import { toastFailed, toastSaved } from './toast'
import { statusLight, statusText } from './OrderHeader'
import { amountText, productText, ruleText } from './pricingRuleFormat'
import { formatDate } from '../formatStamp'
import { money, moneyOptions } from '../money'

const MONEY = moneyOptions()

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
        <Field label='Blocked'>
          <StatusLight variant={customer.blocked ? 'negative' : 'neutral'} marginStart='size-0'>
            {customer.blocked ? 'Blocked' : 'Open'}
          </StatusLight>
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
                  <Cell><StatusLight variant={statusLight(o.status)}>{statusText(o.status)}</StatusLight></Cell>
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

export default function CustomerDetail ({ api, id, onBack, onChanged, onNavigate }) {
  const { rows, error, reload, updateRow } = useLoad(async () => [await api.partner(id)], [api, id])
  const customer = rows && rows[0]
  const [busy, setBusy] = useState(false)
  const [openOrder, setOpenOrder] = useState(null)

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

  if (openOrder) {
    return (
      <OrderDetail
        key={openOrder}
        api={api}
        number={openOrder}
        backLabel={customer ? customer.name : 'Customer'}
        onBack={() => { setOpenOrder(null); reload() }}
        onChanged={onChanged}
      />
    )
  }

  const back = (
    <ActionButton isQuiet onPress={onBack} marginBottom='size-150'>
      <ChevronLeft />
      <Text>Customers</Text>
    </ActionButton>
  )

  if (!customer) {
    return (
      <>
        {back}
        {error
          ? (
            <InlineAlert variant='negative'>
              <Heading>Something went wrong</Heading>
              <Content>{error.message}</Content>
            </InlineAlert>
            )
          : <PageLoading label='Loading customer' />}
      </>
    )
  }

  return (
    <>
      {back}
      <div className='erp-page-header'>
        <div>
          <Heading level={1} marginY={0}>{customer.name}</Heading>
          <Text UNSAFE_className='erp-subtle'>Customer {customer.id}</Text>
        </div>
        {/* The walk-in account cannot be blocked: nothing in Commerce answers to it. */}
        {customer.credit && (
          <div className='erp-page-actions'>
            <Button
              variant={customer.blocked ? 'secondary' : 'negative'}
              isDisabled={busy}
              onPress={() => patch({ blocked: !customer.blocked }, customer.blocked ? 'Customer unblocked' : 'Customer blocked')}
            >
              {customer.blocked ? 'Unblock' : 'Block customer'}
            </Button>
          </div>
        )}
      </div>
      {error && (
        <InlineAlert variant='negative' marginBottom='size-200'>
          <Heading>Something went wrong</Heading>
          <Content>{error.message}</Content>
        </InlineAlert>
      )}
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
      <OrdersCard orders={customer.orders || []} onOpen={setOpenOrder} />
      <PricingCard conditions={customer.conditions || []} onNavigate={onNavigate} />
    </>
  )
}
