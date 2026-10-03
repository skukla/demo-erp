/*
 * The lines of a sales order document, and the three money figures under them.
 *
 * Lines are numbered 10, 20, 30 — every ERP numbers them in tens — and each carries the
 * product's description and its base unit, because a quantity with no unit is not a
 * quantity an ERP would print. Shipped and Open are the two quantities a fulfilment
 * story turns on; they are the ERP's own numbers, never typed here.
 *
 * Close remaining sits on the line it closes: giving up on 3 of 4 EA is a decision about
 * that line, and the reason is recorded on it.
 */
import React, { useState } from 'react'
import {
  TableView, TableHeader, Column, TableBody, Row, Cell, Text,
  ActionButton, Button, ButtonGroup, Content, Dialog, DialogTrigger, Divider, Heading, Item, Picker
} from '@adobe/react-spectrum'
import { money } from '../money'
import Card from './Card'
import Totals from './Totals'
import { discountTotal, withDiscountColumn } from './lineDiscount'

/* The lines are printed, not browsed: no resizing and no sorting, so the headers carry
   no chevrons to suggest otherwise. An order's lines are in their own order — that is
   what the item numbers mean — and reordering them would be a lie about the document.
   Widths go straight on the Columns; Spectrum gives the description whatever is left. */

/** Close what is still open on one line: pick a reason, then confirm. */
function CloseRemaining ({ line, reasons, onClose, isDisabled }) {
  const [reason, setReason] = useState(reasons[0])
  return (
    <DialogTrigger>
      <ActionButton isQuiet isDisabled={isDisabled}>Close remaining</ActionButton>
      {(close) => (
        <Dialog>
          <Heading>Close {line.openQty} {line.unit} on Item {line.item}?</Heading>
          <Divider />
          <Content>
            <Text>
              The {line.openQty} {line.unit} of {line.name} still open will not ship. The order can then be
              invoiced once every other line has shipped.
            </Text>
            <Picker
              label='Reason'
              items={reasons.map((r) => ({ id: r }))}
              selectedKey={reason}
              onSelectionChange={(key) => setReason(String(key))}
              marginTop='size-200'
              width='100%'
            >
              {(item) => <Item key={item.id}>{item.id}</Item>}
            </Picker>
          </Content>
          <ButtonGroup>
            <Button variant='secondary' onPress={close}>Keep it open</Button>
            <Button variant='negative' onPress={() => { close(); onClose(reason) }}>Close remaining</Button>
          </ButtonGroup>
        </Dialog>
      )}
    </DialogTrigger>
  )
}

/** What a line's Open cell says: the quantity, or why there is none left. */
function openText (line) {
  if (line.openQty > 0) return String(line.openQty)
  if (line.closedQty > 0) return `0 · ${line.closedQty} closed`
  return '0'
}

/* Dynamic columns, not JSX children with a conditional among them: Spectrum's table
   builds its collection from the children it is handed, and a `false` where a Column or
   Cell should be leaves a hole it then reads (`isRowHeader` of undefined) and crashes.
   The Close column is in the list only while a line can still be closed. */
/* The widths add up to what a 1,440px window gives the table (1,118 px) WITH the Close column:
   they added up to 34 px more on every order, 204 px with Close, and the table scrolled
   sideways, its last column reading "NET AMOU…" at the edge (2026-10-03). Each is its heading
   or its widest cell plus a few px (Item's 75 is Spectrum's own minimum; cells wrap, headings
   do not), and the Close button is 162 px. A closable order WITH a discount column still does
   not fit: that needs shorter headings or a narrower Close, not narrower columns. */
const LINE_COLUMNS = [
  { key: 'item', label: 'Item', width: 75 },
  { key: 'sku', label: 'Product', width: 98 },
  { key: 'name', label: 'Description', width: '1fr', minWidth: 120 },
  { key: 'qty', label: 'Order qty', width: 108, align: 'end' },
  { key: 'shipped', label: 'Shipped', width: 92, align: 'end' },
  { key: 'open', label: 'Open', width: 108, align: 'end' },
  { key: 'unit', label: 'Base unit', width: 102 },
  { key: 'price', label: 'Net price', width: 118, align: 'end' },
  { key: 'amount', label: 'Net amount', width: 126, align: 'end' }
]
const CLOSE_COLUMN = { key: 'close', label: ' ', width: 164, align: 'end' }

export default function OrderLines ({ order, onCloseLine, busy, onOpen }) {
  const lines = order.lines || []
  const canClose = Boolean(order.can && order.can.close && onCloseLine)
  // A Discount column only when a line carries one (lineDiscount.js).
  const discount = discountTotal(lines)
  const priced = withDiscountColumn(LINE_COLUMNS, lines)
  const columns = canClose ? [...priced, CLOSE_COLUMN] : priced

  function cell (line, key) {
    if (key === 'open') return openText(line)
    if (key === 'price') return money(line.price, order.currency)
    if (key === 'discount') return money(line.discount || 0, order.currency)
    if (key === 'amount') return money(line.amount, order.currency)
    if (key === 'shipped') return line.shippedQty
    // Master data is one click from the document: the SKU opens the product on the trail.
    if (key === 'sku' && onOpen) return <button type='button' className='erp-link' onClick={() => onOpen('product', line.sku)}>{line.sku}</button>
    if (key === 'close') {
      return line.openQty > 0
        ? <CloseRemaining line={line} reasons={order.closeReasons || []} isDisabled={busy} onClose={(reason) => onCloseLine(line.item, reason)} />
        : null
    }
    return line[key]
  }

  return (
    <Card>
      {/* Keyed on the column set as well: the table builds its column model once, so a
          Column that appears or disappears on a later render needs a remount. */}
      <TableView key={`${canClose ? 'lines-closable' : 'lines'}${discount > 0 ? '-discount' : ''}`} aria-label='Order lines' density='compact' overflowMode='wrap'>
        <TableHeader columns={columns}>
          {(c) => <Column key={c.key} width={c.width} minWidth={c.minWidth} align={c.align}>{c.label}</Column>}
        </TableHeader>
        <TableBody items={lines.map((l) => ({ ...l, id: l.item }))}>
          {(line) => (
            <Row key={line.item}>
              {(key) => <Cell>{cell(line, key)}</Cell>}
            </Row>
          )}
        </TableBody>
      </TableView>
      {lines.length === 0 && (
        <Text marginTop='size-200'>This order has no lines.</Text>
      )}
      <Totals discount={discount} net={order.net} tax={order.tax} total={order.total} currency={order.currency} />
    </Card>
  )
}
