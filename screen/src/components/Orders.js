/*
 * Sales orders: the list. Search by number, by the Commerce order it came from, or by
 * customer; sort any column; choose a row to open the order's document.
 *
 * The list does not act on orders. It used to carry a "Move to" button group in every
 * row, which is the most prototype-looking thing a screen can do — an ERP acts on an
 * order from the order's own document, where you can see what you are about to change.
 * The buttons moved there when the document arrived.
 */
import React, { useMemo, useState } from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, StatusLight, Picker, Item } from '@adobe/react-spectrum'
import Frame from './Frame'
import { useTrail, OpenDocument, useOpenFromQuery } from './Documents'
import { useLoad } from './useLoad'
import { useColumnWidths } from './columnWidths'
import { useGridView, GridSearch } from './GridView'
import { formatDate } from '../formatStamp'
import { money } from '../money'
import { statusLight, statusText, shippingBadge, billingBadge } from './OrderHeader'

/* Business Central calls this the External Document No.; it is the customer's own
   reference for the order, which is exactly what the Commerce increment id is. */
const reference = (o) => o.commerceIncrementId || o.commerceOrderId || '—'

/* Each sortable header carries a chevron, which eats about 24px of its width: a
   column sized to its title alone truncates the title. */
/* Sold-to now carries an id AND a name, so it takes twice the slack of Reference. */
/* Lines (a count nobody sorted by) gave way to Shipping and Billing: the two derived
   states an order's single Status word hides (UI audit §Sales Orders). Eight columns fit
   a 1,440px window with the rail open. */
const ORDER_COLUMNS = [
  { key: 'number', width: 150 },
  { key: 'date', width: 120 },
  { key: 'reference', width: '1fr', minWidth: 130 },
  { key: 'partner', width: '2fr', minWidth: 210 },
  { key: 'shipping', width: 135 },
  { key: 'billing', width: 125 },
  { key: 'total', width: 125 },
  { key: 'status', width: 130 }
]

const ORDER_GRID = {
  fields: [(o) => o.number, (o) => reference(o), (o) => o.partnerId, (o) => o.partnerName, (o) => statusText(o.status)],
  values: {
    number: (o) => o.number,
    date: (o) => Date.parse(o.createdAt) || 0,
    reference: (o) => reference(o),
    partner: (o) => o.partnerId || '',
    shipping: (o) => shippingBadge(o.shippingStatus)[0],
    billing: (o) => billingBadge(o.billingStatus)[0],
    total: (o) => o.total || 0,
    status: (o) => statusText(o.status)
  },
  sort: { column: 'number', direction: 'descending' }
}

/* The work a cue on Home counted, as a filter here. Each key names the ability the
   ERP put on the row (lib/work orderCues reads the same abilities), so the list and
   the count cannot disagree. */
const WORK = [
  { key: 'all', label: 'All orders' },
  { key: 'toConfirm', label: 'To confirm', can: 'confirm' },
  { key: 'onHold', label: 'On credit hold', can: 'release' },
  { key: 'toShip', label: 'To ship', can: 'ship' },
  { key: 'toInvoice', label: 'To invoice', can: 'invoice' }
]
const workKey = (asked) => (WORK.some((w) => w.key === asked) ? asked : 'all')

/* Where the order stands, in the one word its header shows (lib/orders overallStatus). */
const STAGES = [
  { key: 'all', label: 'Every stage' },
  { key: 'Open', label: 'Open' },
  { key: 'In process', label: 'In process' },
  { key: 'Completed', label: 'Completed' },
  { key: 'Cancelled', label: 'Cancelled' }
]

export default function Orders ({ api, query = {}, onChanged, onNavigate }) {
  const widths = useColumnWidths('orders', ORDER_COLUMNS)
  const { rows, error, reload } = useLoad(() => api.orders(), [api])
  const [work, setWork] = useState(() => workKey(query.work))
  const [stage, setStage] = useState('all')
  const shown = useMemo(() => {
    const chosen = WORK.find((w) => w.key === work)
    const byWork = !rows || !chosen || !chosen.can ? rows : rows.filter((o) => o.can && o.can[chosen.can])
    if (!byWork || stage === 'all') return byWork
    return byWork.filter((o) => o.overall === stage)
  }, [rows, work, stage])
  const view = useGridView(shown, ORDER_GRID)
  // The documents opened from the list: the order, then whatever it opens (Documents.js).
  const trail = useTrail('Sales Orders')
  useOpenFromQuery(trail, query, 'order')

  if (trail.top) {
    return <OpenDocument trail={trail} api={api} onChanged={onChanged} onNavigate={onNavigate} onClose={reload} />
  }

  return (
    <Frame title='Sales Orders' error={error} loading={!rows}>
      <GridSearch placeholder='Order, reference or customer' view={view}>
        <Picker aria-label='Work' label='Show' selectedKey={work} onSelectionChange={(k) => setWork(String(k))} items={WORK}>
          {(w) => <Item key={w.key}>{w.label}</Item>}
        </Picker>
        <Picker aria-label='Stage' label='Stage' selectedKey={stage} onSelectionChange={(k) => setStage(String(k))} items={STAGES}>
          {(s) => <Item key={s.key}>{s.label}</Item>}
        </Picker>
      </GridSearch>
      <TableView {...widths.tableProps} {...view.tableProps}
        aria-label='Sales Orders' density='compact' overflowMode='wrap' marginTop='size-200'
        UNSAFE_className='erp-rows-open'
        selectionMode='none' onAction={(key) => trail.open('order', String(key))}>
        <TableHeader>
          <Column key='number' {...widths.columnProps('number')} allowsSorting>Sales order</Column>
          <Column key='date' {...widths.columnProps('date')} allowsSorting>Order date</Column>
          {/* "Reference", not "Customer reference": the full phrase plus its sort
              chevron does not fit beside the Move to buttons, and the reference()
              comment above says what it is. Business Central heads the same field
              External Document No., which is longer still. */}
          <Column key='reference' {...widths.columnProps('reference')} allowsSorting>Reference</Column>
          <Column key='partner' {...widths.columnProps('partner')} allowsSorting>Sold-to</Column>
          <Column key='shipping' {...widths.columnProps('shipping')} allowsSorting>Shipping</Column>
          <Column key='billing' {...widths.columnProps('billing')} allowsSorting>Billing</Column>
          <Column key='total' {...widths.columnProps('total')} align='end' allowsSorting>Net amount</Column>
          <Column key='status' {...widths.columnProps('status')} allowsSorting>Status</Column>
        </TableHeader>
        <TableBody items={view.items}>
          {(o) => (
            <Row key={o.number}>
              <Cell><span className='erp-key'>{o.number}</span></Cell>
              <Cell>{formatDate(o.createdAt)}</Cell>
              <Cell>{reference(o)}</Cell>
              <Cell>{o.partnerName ? `${o.partnerId} · ${o.partnerName}` : (o.partnerId || '—')}</Cell>
              <Cell><StatusLight variant={shippingBadge(o.shippingStatus)[1]}>{shippingBadge(o.shippingStatus)[0]}</StatusLight></Cell>
              <Cell><StatusLight variant={billingBadge(o.billingStatus)[1]}>{billingBadge(o.billingStatus)[0]}</StatusLight></Cell>
              <Cell>{money(o.total, o.currency)}</Cell>
              <Cell><StatusLight variant={statusLight(o.status)}>{statusText(o.status)}</StatusLight></Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
