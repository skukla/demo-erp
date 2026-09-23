/*
 * Pricing rules: what a customer pays, decided before an order is placed.
 *
 * SAP calls these condition records; the screen does not, because "condition" explains
 * nothing to anyone who has not used SAP. Each row says what the rule DOES and carries
 * its code beside it (pricingRuleFormat.js).
 *
 * One full-width list. The form that used to stand beside it is a dialog behind the
 * page's Add button, and the price test is a section underneath — the two of them took
 * a third of the screen permanently and left the rules squeezed into what was left.
 *
 * Remove stays on the row. The rule elsewhere is that a list does not act on records —
 * an order is acted on from its own document — but a pricing rule has no document, and
 * deleting a row from a small table is a table operation, not a workflow step.
 */
import React, { useMemo, useState } from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, ActionButton } from '@adobe/react-spectrum'
import Frame from './Frame'
import AddPricingRule from './AddPricingRule'
import PriceTest from './PriceTest'
import { useLoad } from './useLoad'
import { toastSaved } from './toast'
import { useColumnWidths } from './columnWidths'
import { amountText, customerText, productText, ruleText } from './pricingRuleFormat'

const RULE_COLUMNS = [
  { key: 'rule', width: '1fr', minWidth: 230 },
  { key: 'customer', width: '1fr', minWidth: 190 },
  { key: 'product', width: '1fr', minWidth: 190 },
  { key: 'amount', width: 150 },
  { key: 'remove', width: 120, resizable: false }
]

export default function Pricing ({ api, onChanged }) {
  const widths = useColumnWidths('pricing', RULE_COLUMNS)
  const { rows, error, reload } = useLoad(() => api.conditions(), [api])
  // Read separately rather than folded into the rules: a row needs the customer's NAME
  // (C000101 tells a room nothing) and so does the price test below, and there are
  // rules-free stores where the first list is empty and this one is not.
  const { rows: customers } = useLoad(() => api.partners(), [api])
  const customerNames = useMemo(
    () => new Map((customers || []).map((c) => [c.id, c.name])),
    [customers]
  )
  const [actionError, setActionError] = useState(null)

  async function add (rule) {
    try {
      await api.saveCondition(rule)
      setActionError(null)
      toastSaved('Pricing rule added')
      await reload()
      onChanged()
    } catch (e) { setActionError(e) }
  }

  async function remove (id) {
    try {
      await api.deleteCondition(id)
      setActionError(null)
      toastSaved('Pricing rule deleted')
      await reload()
      onChanged()
    } catch (e) { setActionError(e) }
  }

  return (
    <Frame
      title='Pricing Rules'
      error={actionError || error}
      loading={!rows}
      actions={<AddPricingRule onAdd={add} />}
    >
      <TableView {...widths.tableProps} aria-label='Pricing Rules' density='compact' overflowMode='wrap'>
        <TableHeader>
          <Column key='rule' {...widths.columnProps('rule')}>Rule</Column>
          <Column key='customer' {...widths.columnProps('customer')}>Customer</Column>
          <Column key='product' {...widths.columnProps('product')}>Product</Column>
          <Column key='amount' {...widths.columnProps('amount')} align='end'>Amount</Column>
          <Column key='remove' {...widths.columnProps('remove')}> </Column>
        </TableHeader>
        <TableBody items={rows || []}>
          {(c) => (
            <Row key={c._id}>
              <Cell>{ruleText(c.kind)}</Cell>
              <Cell>{customerText(c, customerNames)}</Cell>
              <Cell>{productText(c)}</Cell>
              <Cell>{amountText(c)}</Cell>
              <Cell><ActionButton isQuiet onPress={() => remove(c._id)}>Remove</ActionButton></Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
      <PriceTest api={api} customers={customers || []} onError={setActionError} />
    </Frame>
  )
}
