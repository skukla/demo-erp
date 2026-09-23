/*
 * The lines of a sales order document, and the three money figures under them.
 *
 * Lines are numbered 10, 20, 30 — every ERP numbers them in tens — and each carries the
 * product's description and its base unit, because a quantity with no unit is not a
 * quantity an ERP would print.
 */
import React from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, Flex, Text, View } from '@adobe/react-spectrum'
import { money } from '../money'

/* The lines are printed, not browsed: no resizing and no sorting, so the headers carry
   no chevrons to suggest otherwise. An order's lines are in their own order — that is
   what the item numbers mean — and reordering them would be a lie about the document.
   Widths go straight on the Columns; Spectrum gives the description whatever is left. */

const TOTAL_LABEL_STYLE = { color: 'var(--spectrum-global-color-gray-700)' }

/** One figure in the totals block: a label on the left, the amount right-aligned. */
function Total ({ label, amount, currency, strong }) {
  return (
    <Flex justifyContent='space-between' gap='size-400'>
      <Text UNSAFE_style={strong ? undefined : TOTAL_LABEL_STYLE}>
        {strong ? <strong>{label}</strong> : label}
      </Text>
      <Text>{strong ? <strong>{money(amount, currency)}</strong> : money(amount, currency)}</Text>
    </Flex>
  )
}

export default function OrderLines ({ order }) {
  const lines = order.lines || []
  return (
    <>
      <TableView aria-label='Order lines' density='compact' overflowMode='wrap'>
        <TableHeader>
          <Column key='item' width={90}>Item</Column>
          <Column key='sku' width={170}>Product</Column>
          <Column key='name' width='1fr' minWidth={220}>Description</Column>
          <Column key='qty' width={130} align='end'>Order qty</Column>
          <Column key='unit' width={110}>Base unit</Column>
          <Column key='price' width={150} align='end'>Net price</Column>
          <Column key='amount' width={160} align='end'>Net amount</Column>
        </TableHeader>
        <TableBody items={lines.map((l) => ({ ...l, id: l.item }))}>
          {(line) => (
            <Row key={line.item}>
              <Cell>{line.item}</Cell>
              <Cell>{line.sku}</Cell>
              <Cell>{line.name}</Cell>
              <Cell>{line.qty}</Cell>
              <Cell>{line.unit}</Cell>
              <Cell>{money(line.price, order.currency)}</Cell>
              <Cell>{money(line.amount, order.currency)}</Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
      {lines.length === 0 && (
        <Text marginTop='size-200'>This order has no lines.</Text>
      )}
      {/* Net is the lines. Total is what Commerce charged. The ERP does not calculate
          tax; it reports the difference, which is why the row is absent when there is
          none rather than printing a zero it did not work out. */}
      <View marginTop='size-300' marginStart='auto' width='size-3600'>
        <Flex direction='column' gap='size-100'>
          <Total label='Net amount' amount={order.net} currency={order.currency} />
          {order.tax !== 0 && <Total label='Tax' amount={order.tax} currency={order.currency} />}
          <Total label='Total' amount={order.total} currency={order.currency} strong />
        </Flex>
      </View>
    </>
  )
}
