/*
 * Invoices: the list. One per invoiced order; choose a row to open the invoice. An
 * invoice raised in Commerce before the ERP kept invoice documents has no number here
 * and cannot be opened; it is listed so the count is honest.
 *
 * Each row says what is still open on it (contract version 14), and Home's "Invoices to
 * collect" lands here filtered to the invoices Post payment is offered on.
 */
import React, { useMemo, useState } from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, StatusLight, Picker, Item } from '@adobe/react-spectrum'
import Frame from './Frame'
import { useLoad } from './useLoad'
import { useColumnWidths } from './columnWidths'
import { useGridView, GridSearch } from './GridView'
import { useTrail, OpenDocument, useOpenFromQuery } from './Documents'
import { paymentStatusText, paymentStatusLight } from './paymentFormat'
import { canPayInvoice } from '../../../lib/return-moves'
import { formatDate } from '../formatStamp'
import { money } from '../money'

const INVOICE_COLUMNS = [
  { key: 'number', width: 165 },
  { key: 'date', width: 140 },
  { key: 'order', width: 150 },
  { key: 'partner', width: '2fr', minWidth: 220 },
  { key: 'total', width: 150 },
  { key: 'open', width: 150 },
  { key: 'status', width: 140 }
]

const soldTo = (i) => (i.partnerName ? `${i.partnerId} · ${i.partnerName}` : (i.partnerId || '—'))

const statusText = paymentStatusText

/* Home's "Invoices to collect" lands here with ?work=toCollect: the rule its count reads. */
const SHOW = [
  { key: 'all', label: 'All invoices', keep: () => true },
  { key: 'toCollect', label: 'To collect', keep: canPayInvoice },
  { key: 'paid', label: 'Paid', keep: (i) => i.paymentStatus === 'paid' },
  { key: 'credited', label: 'Credited', keep: (i) => i.paymentStatus === 'credited' }
]
const showKey = (asked) => (SHOW.some((x) => x.key === asked) ? asked : 'all')

const INVOICE_GRID = {
  fields: [(i) => i.number, (i) => i.orderNumber, (i) => i.partnerId, (i) => i.partnerName, (i) => statusText(i)],
  values: {
    number: (i) => i.number || '',
    date: (i) => Date.parse(i.createdAt) || 0,
    order: (i) => i.orderNumber,
    partner: (i) => i.partnerId || '',
    total: (i) => i.total || 0,
    open: (i) => i.openAmount || 0,
    status: (i) => statusText(i)
  },
  sort: { column: 'number', direction: 'descending' }
}

export default function Invoices ({ api, query = {}, onChanged, onNavigate }) {
  const widths = useColumnWidths('invoices', INVOICE_COLUMNS)
  const { rows, error, reload } = useLoad(() => api.invoices(), [api])
  const [show, setShow] = useState(() => showKey(query.work))
  const shown = useMemo(() => (rows ? rows.filter(SHOW.find((x) => x.key === show).keep) : rows), [rows, show])
  const view = useGridView(shown, INVOICE_GRID)
  const trail = useTrail('Invoices')
  useOpenFromQuery(trail, query, 'invoice')

  if (trail.top) {
    return <OpenDocument trail={trail} api={api} onChanged={onChanged} onNavigate={onNavigate} onClose={reload} />
  }

  return (
    <Frame title='Invoices' error={error} loading={!rows}>
      <GridSearch placeholder='Invoice, order or customer' view={view}>
        <Picker aria-label='Payment status' label='Show' selectedKey={show} onSelectionChange={(k) => setShow(String(k))} items={SHOW}>
          {(x) => <Item key={x.key}>{x.label}</Item>}
        </Picker>
      </GridSearch>
      <TableView {...widths.tableProps} {...view.tableProps}
        aria-label='Invoices' density='compact' overflowMode='wrap' marginTop='size-200'
        UNSAFE_className='erp-rows-open'
        selectionMode='none' onAction={(key) => { if (!String(key).startsWith('legacy:')) trail.open('invoice', String(key)) }}>
        <TableHeader>
          <Column key='number' {...widths.columnProps('number')} allowsSorting>Invoice</Column>
          <Column key='date' {...widths.columnProps('date')} allowsSorting>Billing date</Column>
          <Column key='order' {...widths.columnProps('order')} allowsSorting>Sales order</Column>
          <Column key='partner' {...widths.columnProps('partner')} allowsSorting>Sold-to</Column>
          <Column key='total' {...widths.columnProps('total')} align='end' allowsSorting>Total</Column>
          <Column key='open' {...widths.columnProps('open')} align='end' allowsSorting>Open amount</Column>
          <Column key='status' {...widths.columnProps('status')} allowsSorting>Payment status</Column>
        </TableHeader>
        <TableBody items={view.items.map((i) => ({ ...i, id: i.number || `legacy:${i.orderNumber}` }))}>
          {(i) => (
            <Row key={i.id}>
              <Cell>{i.number ? <span className='erp-key'>{i.number}</span> : 'Invoiced (no document)'}</Cell>
              <Cell>{formatDate(i.createdAt)}</Cell>
              <Cell>{i.orderNumber}</Cell>
              <Cell>{soldTo(i)}</Cell>
              <Cell>{money(i.total, i.currency)}</Cell>
              <Cell>{i.openAmount === undefined ? '—' : money(i.openAmount, i.currency)}</Cell>
              <Cell><StatusLight variant={paymentStatusLight(i)}>{statusText(i)}</StatusLight></Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
