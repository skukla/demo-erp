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
              invoiced once every other line has shipped. Commerce invoices the order as placed.
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
const LINE_COLUMNS = [
  { key: 'item', label: 'Item', width: 80 },
  { key: 'sku', label: 'Product', width: 150 },
  { key: 'name', label: 'Description', width: '1fr', minWidth: 200 },
  { key: 'qty', label: 'Order qty', width: 110, align: 'end' },
  { key: 'shipped', label: 'Shipped', width: 110, align: 'end' },
  { key: 'open', label: 'Open', width: 130, align: 'end' },
  { key: 'unit', label: 'Base unit', width: 100 },
  { key: 'price', label: 'Net price', width: 130, align: 'end' },
  { key: 'amount', label: 'Net amount', width: 140, align: 'end' }
]
const CLOSE_COLUMN = { key: 'close', label: ' ', width: 170, align: 'end' }

export default function OrderLines ({ order, onCloseLine, busy }) {
  const lines = order.lines || []
  const canClose = Boolean(order.can && order.can.close && onCloseLine)
  const columns = canClose ? [...LINE_COLUMNS, CLOSE_COLUMN] : LINE_COLUMNS

  function cell (line, key) {
    if (key === 'open') return openText(line)
    if (key === 'price') return money(line.price, order.currency)
    if (key === 'amount') return money(line.amount, order.currency)
    if (key === 'shipped') return line.shippedQty
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
      <TableView key={canClose ? 'lines-closable' : 'lines'} aria-label='Order lines' density='compact' overflowMode='wrap'>
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
      <Totals net={order.net} tax={order.tax} total={order.total} currency={order.currency} />
    </Card>
  )
}
