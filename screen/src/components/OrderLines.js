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
import React, { useMemo, useState } from 'react'
import {
  Text, ActionButton, Button, ButtonGroup, Content, Dialog, DialogTrigger, Divider, Heading, Item, Picker
} from '@adobe/react-spectrum'
import { money } from '../money'
import Card from './Card'
import Totals from './Totals'
import LinesTable from './LinesTable'
import { GRID_COLUMNS, ORDER_LINE_CLOSE } from './gridColumns'
import { discountTotal, withDiscountColumn } from './lineDiscount'

/* An order's lines are in their own order — that is what the item numbers mean — so no
   column sorts. Every column but Item and Close can be dragged wider or narrower
   (./gridColumns.js has the widths and the rule). */

/** Close what is still open on one line: pick a reason, then confirm. */
function CloseRemaining ({ line, reasons, onClose, isDisabled }) {
  const [reason, setReason] = useState(reasons[0])
  return (
    <DialogTrigger>
      {/* "Close", short so the lines fit a 1,280 px window (owner, 2026-10-04); the label says what it closes. */}
      <ActionButton isQuiet isDisabled={isDisabled} aria-label={`Close remaining quantity on line ${line.item}`}>Close</ActionButton>
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

export default function OrderLines ({ order, onCloseLine, busy, onOpen }) {
  const lines = order.lines || []
  const canClose = Boolean(order.can && order.can.close && onCloseLine)
  // A Discount column only when a line carries one (lineDiscount.js).
  const discount = discountTotal(lines)
  const columns = useMemo(() => {
    const priced = withDiscountColumn(GRID_COLUMNS.orderLines, order.lines || [])
    // First, where the edge never reaches: a line too wide for the window still shows it.
    return canClose ? [ORDER_LINE_CLOSE, ...priced] : priced
  }, [order.lines, canClose])

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
      <LinesTable tableId='orderLines' label='Order lines' columns={columns} lines={lines} cell={cell} />
      {lines.length === 0 && (
        <Text marginTop='size-200'>This order has no lines.</Text>
      )}
      <Totals discount={discount} net={order.net} tax={order.tax} total={order.total} currency={order.currency} />
    </Card>
  )
}
