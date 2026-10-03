/*
 * One customer's document: the business-partner master, as an ERP shows it. The list
 * holds a row; this holds the account — its facts as labelled fields, its credit, its
 * own sales orders, its price group, the price lists that apply to it, and the pricing
 * rules agreed with it.
 *
 * Credit is the card an ERP eye looks for first, and it is the one that is NOT there for
 * the walk-in account: a customer with no Commerce company has no credit relationship,
 * so the ERP answers no credit and the card is left out rather than showing a zero.
 * Exposure is worked out by the ERP on read (lib/partners describePartner), never kept: its
 * open orders plus its open items, the invoices not yet paid (contract version 14).
 *
 * Blocking is a verb on the page header — Block customer / Unblock — the way the order
 * document's actions are. The list keeps its switch for quick edits while preparing a
 * demo; here you look at the account before you block it.
 */
import React, { useMemo, useState } from 'react'
import {
  Grid, Item, Link, Meter, Picker, StatusLight, Text, View,
  TableView, TableHeader, Column, TableBody, Row, Cell
} from '@adobe/react-spectrum'
import Card from './Card'
import Field from './Field'
import DocumentPage from './DocumentPage'
import EditableNumber from './EditableNumber'
import OpenItemsCard from './OpenItemsCard'
import { useLoad } from './useLoad'
import { toastFailed, toastSaved } from './toast'
import { statusLight, statusText } from './OrderHeader'
import { amountText, productText, ruleText, todayIso } from './pricingRuleFormat'
import { appliesToText, contractStatus, termText } from './contractFormat'
import { formatDate } from '../formatStamp'
import { money, moneyOptions } from '../money'
import { useColumnWidths } from './columnWidths'
import { GRID_COLUMNS } from './gridColumns'

const MONEY = moneyOptions()

/* This ERP's own credit block: Business Central's four levels, in plainer words, each saying
   what it stops. Set only here, by this ERP's finance team; Commerce never changes it. */
export const BLOCKING_LEVELS = [
  { id: 'open', label: 'None', help: 'Everything allowed' },
  { id: 'shipping', label: 'Stop shipping', help: 'New orders arrive on credit hold; nothing new ships; existing shipments can still be invoiced' },
  { id: 'invoicing', label: 'Stop invoicing', help: 'New orders on hold; nothing ships; no new invoices' },
  { id: 'all', label: 'Stop all', help: 'Nothing proceeds' }
]
export const CREDIT_BLOCK_LABEL = 'Credit block'
export const CREDIT_BLOCK_HELP = 'Set here. Stops this ERP\'s orders only.'

/* The website account: Commerce's company Active/Blocked switch, copied here, read-only. */
export const WEBSITE_ACCOUNT_LABEL = 'Website account'
export const WEBSITE_ACCOUNT_HELP = 'Set in Commerce. Closed stops all website orders.'
export const websiteAccountText = (value) => (value === 'closed' ? 'Closed' : 'Active')
export const blockingText = (level) => (BLOCKING_LEVELS.find((l) => l.id === level) || BLOCKING_LEVELS[0]).label

/** "1000 · Main Website, 2000 · Online EU"; the walk-in account is in every one; none yet prints so. */
export function salesOrgsText (customer) {
  const codes = customer.salesOrgs || []
  if (codes.includes('*')) return 'Every sales organization'
  if (codes.length === 0) return 'None yet'
  const names = customer.salesOrgNames || {}
  return codes.map((code) => (names[code] ? `${code} · ${names[code]}` : code)).join(', ')
}

/** One line for a legal address, or a dash. */
export function addressText (address) {
  if (!address) return '—'
  const parts = [...(address.street || []), [address.postcode, address.city].filter(Boolean).join(' '), address.region, address.countryId].filter(Boolean)
  return parts.length ? parts.join(', ') : '—'
}

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
        {/* What the exposure is made of: the two lists below add up to it. */}
        <Field label='Open orders'>{money(credit.openOrders)}</Field>
        <Field label='Open items'>{money(credit.openItems)}</Field>
        <Field label='Available credit'>
          <Text UNSAFE_style={over ? { fontWeight: 600 } : undefined}>{money(credit.available)}</Text>
        </Field>
        <Field label='Credit status'>
          <StatusLight variant={over ? 'negative' : 'positive'} marginStart='size-0'>
            {over ? 'Over limit' : 'Within limit'}
          </StatusLight>
        </Field>
        <Field label={CREDIT_BLOCK_LABEL} help={CREDIT_BLOCK_HELP}>
          <StatusLight variant={customer.blocking === 'open' ? 'neutral' : 'negative'} marginStart='size-0'>
            {blockingText(customer.blocking)}
          </StatusLight>
        </Field>
        <Field label={WEBSITE_ACCOUNT_LABEL} help={WEBSITE_ACCOUNT_HELP}>
          <StatusLight variant={customer.websiteAccount === 'closed' ? 'negative' : 'neutral'} marginStart='size-0'>
            {websiteAccountText(customer.websiteAccount)}
          </StatusLight>
        </Field>
        {/* SAP's work list of blocked documents, for this customer. */}
        <Field label='Orders on credit hold'>
          {credit.held > 0
            ? <StatusLight variant='negative' marginStart='size-0'>{`${credit.held} held`}</StatusLight>
            : 'None'}
        </Field>
      </Grid>
      {/* How much of the limit is used, as a proportion: what Fiori's credit account and
          Business Central's customer statistics both show. Red once exposure passes the limit. */}
      {credit.limit > 0 && (
        <View marginTop='size-250'>
          <Meter
            label='Credit used'
            value={Math.min(100, Math.round((credit.exposure / credit.limit) * 100))}
            valueLabel={`${money(credit.exposure)} of ${money(credit.limit)}${over ? ' — over the limit' : ''}`}
            variant={over ? 'critical' : (credit.exposure / credit.limit > 0.8 ? 'warning' : 'positive')}
            width='100%'
          />
        </View>
      )}
      {/* Which exposure is the truth here (bidirectional review, gap G3): the ERP's, from its
          open orders and open items. Commerce keeps a balance of its own for payment on
          account; the two are different numbers and this card does not compare them.
          View, not a margin on Text: Spectrum's Text takes no layout props. */}
      <View marginTop='size-250'>
        <Text UNSAFE_className='erp-subtle'>
          Exposure is the net amount of this customer's sales orders not yet invoiced, plus what is open on its invoices.
        </Text>
      </View>
    </Card>
  )
}

/* The orders exposure counts: not yet invoiced, not canceled, not on credit hold
   (lib/partners exposures uses the same rule). */
const OPEN_ORDERS = new Set(['created', 'confirmed', 'shipped'])
const isOpenOrder = (o) => OPEN_ORDERS.has(o.status) && o.creditStatus !== 'held'

const SHOW = [
  { key: 'open', label: 'Open orders' },
  { key: 'all', label: 'History' }
]

/**
 * Open orders first — the uninvoiced orders that are one part of the exposure figure; the
 * open items card below is the other — and the whole history behind a switch.
 */
function OrdersCard ({ orders, onOpen, hasCredit }) {
  const widths = useColumnWidths('customerOrders', GRID_COLUMNS.customerOrders)
  const [show, setShow] = useState(hasCredit ? 'open' : 'all')
  const shown = show === 'open' ? orders.filter(isOpenOrder) : orders
  const openNet = orders.filter(isOpenOrder).reduce((sum, o) => sum + (o.net || 0), 0)
  return (
    <Card
      title={show === 'open' ? 'Open orders' : 'Sales Orders'}
      actions={hasCredit && (
        <Picker aria-label='Show' selectedKey={show} onSelectionChange={(k) => setShow(String(k))} items={SHOW} isQuiet>
          {(x) => <Item key={x.key}>{x.label}</Item>}
        </Picker>
      )}
    >
      {show === 'open' && shown.length > 0 && (
        <Text UNSAFE_className='erp-subtle'>{`${shown.length} open ${shown.length === 1 ? 'order' : 'orders'} · ${money(openNet, shown[0].currency)} — ordered, not yet invoiced.`}</Text>
      )}
      {shown.length === 0
        ? <Text>{show === 'open' ? 'No open orders: nothing this customer has ordered is still uninvoiced.' : 'No sales orders for this customer.'}</Text>
        : (
          <TableView {...widths.tableProps}
            aria-label="This customer's sales orders" density='compact' overflowMode='wrap'
            UNSAFE_className='erp-rows-open' selectionMode='none' onAction={(key) => onOpen(String(key))}
          >
            <TableHeader>
              <Column key='number' {...widths.columnProps('number')}>Sales order</Column>
              <Column key='date' {...widths.columnProps('date')}>Order date</Column>
              <Column key='reference' {...widths.columnProps('reference')}>Reference</Column>
              <Column key='net' {...widths.columnProps('net')} align='end'>Net amount</Column>
              <Column key='status' {...widths.columnProps('status')}>Status</Column>
            </TableHeader>
            <TableBody items={shown.map((o) => ({ ...o, id: o.number }))}>
              {(o) => (
                <Row key={o.number}>
                  <Cell><span className='erp-key'>{o.number}</span></Cell>
                  <Cell>{formatDate(o.createdAt)}</Cell>
                  <Cell>{o.purchaseOrderByCustomer || '—'}</Cell>
                  <Cell>{money(o.net, o.currency)}</Cell>
                  <Cell>
                    {o.creditStatus === 'held' && o.status !== 'canceled'
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
  const widths = useColumnWidths('customerPricing', GRID_COLUMNS.customerPricing)
  return (
    <Card
      title='Pricing'
      actions={onNavigate && <Link isQuiet onPress={() => onNavigate('pricing')}>Pricing →</Link>}
    >
      {conditions.length === 0
        ? <Text>No pricing rules are agreed with this customer; it pays list price.</Text>
        : (
          <TableView {...widths.tableProps} aria-label='Pricing rules for this customer' density='compact' overflowMode='wrap'>
            <TableHeader>
              <Column key='rule' {...widths.columnProps('rule')}>Rule</Column>
              <Column key='product' {...widths.columnProps('product')}>Product</Column>
              <Column key='amount' {...widths.columnProps('amount')} align='end'>Amount</Column>
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

/* The price lists that apply to this customer: its own, then its price group's (lib/partners
   describePartner); a row opens the list on the same trail. */
function PriceListsCard ({ contracts, groupNames, onOpen, onNavigate }) {
  const widths = useColumnWidths('customerPriceLists', GRID_COLUMNS.customerPriceLists)
  const today = todayIso()
  return (
    <Card
      title='Price lists'
      actions={onNavigate && <Link isQuiet onPress={() => onNavigate('contracts')}>Price lists →</Link>}
    >
      {contracts.length === 0
        ? <Text>No price list applies to this customer.</Text>
        : (
          <TableView {...widths.tableProps}
            aria-label="This customer's price lists" density='compact' overflowMode='wrap'
            UNSAFE_className='erp-rows-open' selectionMode='none' onAction={(key) => onOpen(String(key))}
          >
            <TableHeader>
              <Column key='number' {...widths.columnProps('number')}>Price list</Column>
              <Column key='appliesTo' {...widths.columnProps('appliesTo')}>Applies to</Column>
              <Column key='description' {...widths.columnProps('description')}>Description</Column>
              <Column key='term' {...widths.columnProps('term')}>Term</Column>
              <Column key='status' {...widths.columnProps('status')}>Status</Column>
            </TableHeader>
            <TableBody items={contracts.map((c) => ({ ...c, id: c.number }))}>
              {(c) => (
                <Row key={c.number}>
                  <Cell><span className='erp-key'>{c.number}</span></Cell>
                  <Cell>{c.appliesTo === 'priceGroup' ? appliesToText(c, null, groupNames) : 'This customer'}</Cell>
                  <Cell>{c.description || '—'}</Cell>
                  <Cell>{termText(c)}</Cell>
                  <Cell><StatusLight variant={contractStatus(c, today).variant}>{contractStatus(c, today).text}</StatusLight></Cell>
                </Row>
              )}
            </TableBody>
          </TableView>
          )}
    </Card>
  )
}

/* The customer price group: the ERP's own, set here; Commerce never changes it. */
function PriceGroupPicker ({ customer, groups, isDisabled, onChange }) {
  const items = [{ id: '', name: 'None' }, ...groups.map((g) => ({ id: g.code, name: `${g.code} · ${g.name}` }))]
  return (
    <Picker
      aria-label='Price group'
      items={items}
      selectedKey={customer.priceGroup || ''}
      isDisabled={isDisabled}
      onSelectionChange={(key) => onChange(String(key) || null)}
      isQuiet
    >
      {(item) => <Item key={item.id}>{item.name}</Item>}
    </Picker>
  )
}

/**
 * @param {object} props `id` the customer; `onOpen(kind, number)` opens one of its orders
 *   on the same trail, so Back from the order returns here.
 */
export default function CustomerDetail ({ api, id, backLabel = 'Customers', onBack, onOpen, onChanged, onNavigate }) {
  const { rows, error, reload, updateRow } = useLoad(async () => [await api.partner(id)], [api, id])
  const customer = rows && rows[0]
  const { rows: groups } = useLoad(() => api.priceGroups(), [api])
  const groupNames = useMemo(() => new Map((groups || []).map((g) => [g.code, g.name])), [groups])
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
        /* The credit block is the one decision made on this document; the walk-in account
           cannot be blocked, since nothing in Commerce answers to it. */
        <Picker
          aria-label={CREDIT_BLOCK_LABEL}
          items={BLOCKING_LEVELS}
          selectedKey={customer.blocking}
          isDisabled={busy}
          onSelectionChange={(key) => patch({ blocking: String(key) }, `Credit block: ${blockingText(String(key))}`)}
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
              {/* SAP extends a customer to each sales area it buys through; the list is that. */}
              <Field label='Sold-to in'>{salesOrgsText(customer)}</Field>
              <Field label='Payment terms'>{customer.paymentTerms || '—'}</Field>
              <Field label='Price group' help='Its price lists apply to this customer too.'>
                <PriceGroupPicker
                  customer={customer}
                  groups={groups || []}
                  isDisabled={busy}
                  onChange={(priceGroup) => patch({ priceGroup }, priceGroup ? `Price group: ${priceGroup}` : 'Price group removed')}
                />
              </Field>
            </Grid>
          </Card>
          {/* A company always has a legal identity; a field the mirror did not bring prints a
              dash, and the card stays. */}
          <Card title='Legal identity'>
            <Grid columns={{ base: ['1fr'], M: ['1fr', '1fr', '1fr'] }} gap='size-250'>
              <Field label='Legal name'>{customer.legalName || '—'}</Field>
              <Field label='VAT / Tax ID'>{customer.vatTaxId || '—'}</Field>
              <Field label='Reseller ID'>{customer.resellerId || '—'}</Field>
              <Field label='Legal address'>{addressText(customer.legalAddress)}</Field>
            </Grid>
          </Card>
          {customer.credit && (
            <CreditCard customer={customer} onLimit={(creditLimit) => patch({ creditLimit }, 'Credit limit saved')} />
          )}
          <OrdersCard orders={customer.orders || []} onOpen={(number) => onOpen('order', number)}  hasCredit={Boolean(customer.credit)} />
          {customer.credit && <OpenItemsCard items={customer.openItems || []} onOpen={(number) => onOpen('invoice', number)} />}
          <PriceListsCard
            contracts={customer.contracts || []}
            groupNames={groupNames}
            onOpen={(number) => onOpen('contract', number)}
            onNavigate={onNavigate}
          />
          <PricingCard conditions={customer.conditions || []} onNavigate={onNavigate} />
        </>
      )}
    </DocumentPage>
  )
}
