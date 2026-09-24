/*
 * Pricing: what a customer pays, decided before an order is placed.
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
import { TableView, TableHeader, Column, TableBody, Row, Cell, ActionButton, StatusLight, Switch } from '@adobe/react-spectrum'
import Frame from './Frame'
import AddPricingRule from './AddPricingRule'
import PriceTest from './PriceTest'
import { useLoad } from './useLoad'
import { toastSaved } from './toast'
import { useColumnWidths } from './columnWidths'
import { amountText, customerText, productText, ruleText, statusOf, todayIso, validityText } from './pricingRuleFormat'

const RULE_COLUMNS = [
  /* Fixed columns add up to 590px and the three flexible ones need 480px more, so the
     grid fits the 1,170px content area at a 1,440px window without a horizontal scroll
     (the Remove column was clipped at 1,220px, measured 2026-09-24). */
  { key: 'rule', width: '1fr', minWidth: 170 },
  { key: 'customer', width: '1fr', minWidth: 150 },
  { key: 'product', width: '1fr', minWidth: 130 },
  { key: 'scope', width: 95 },
  { key: 'amount', width: 100 },
  { key: 'minQty', width: 90 },
  { key: 'validity', width: 170 },
  { key: 'status', width: 110 },
  { key: 'remove', width: 90, resizable: false }
]

export default function Pricing ({ api, health, onChanged }) {
  // The sales organisations the structure knows, for the scope picker and column.
  const salesOrgs = (health && health.structure && health.structure.salesOrgs) || []
  const widths = useColumnWidths('pricing', RULE_COLUMNS)
  const { rows, error, reload } = useLoad(() => api.conditions(), [api])
  // Read separately rather than folded into the rules: a row needs the customer's NAME
  // (C000101 tells a room nothing) and so does the price test below, and there are
  // rules-free stores where the first list is empty and this one is not. Products are
  // read for the same reason: the Add dialog and the price test offer them as value
  // help instead of a box to type a SKU into.
  const { rows: customers } = useLoad(() => api.partners(), [api])
  const { rows: products } = useLoad(() => api.products(), [api])
  const customerNames = useMemo(
    () => new Map((customers || []).map((c) => [c.id, c.name])),
    [customers]
  )
  const [actionError, setActionError] = useState(null)
  // Filter to the records in force today: an expired agreement is history, not pricing.
  const [activeOnly, setActiveOnly] = useState(false)
  const today = todayIso()
  const shown = useMemo(
    () => (rows || []).filter((c) => !activeOnly || statusOf(c, today).text === 'Active'),
    [rows, activeOnly, today]
  )

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
      title='Pricing'
      error={actionError || error}
      loading={!rows}
      actions={(
        <>
          <Switch isSelected={activeOnly} onChange={setActiveOnly}>Active only</Switch>
          <AddPricingRule onAdd={add} customers={customers || []} products={products || []} salesOrgs={salesOrgs} />
        </>
      )}
    >
      <TableView {...widths.tableProps} aria-label='Pricing rules' density='compact' overflowMode='wrap'>
        <TableHeader>
          <Column key='rule' {...widths.columnProps('rule')}>Rule</Column>
          <Column key='customer' {...widths.columnProps('customer')}>Customer</Column>
          <Column key='product' {...widths.columnProps('product')}>Product</Column>
          <Column key='scope' {...widths.columnProps('scope')}>Sales org</Column>
          <Column key='amount' {...widths.columnProps('amount')} align='end'>Amount</Column>
          <Column key='minQty' {...widths.columnProps('minQty')} align='end'>Min. qty</Column>
          <Column key='validity' {...widths.columnProps('validity')}>Valid</Column>
          <Column key='status' {...widths.columnProps('status')}>Status</Column>
          <Column key='remove' {...widths.columnProps('remove')}> </Column>
        </TableHeader>
        <TableBody items={shown}>
          {(c) => (
            <Row key={c._id}>
              <Cell>{ruleText(c.kind)}</Cell>
              <Cell>{customerText(c, customerNames)}</Cell>
              <Cell>{productText(c)}</Cell>
              <Cell>{c.salesOrg || 'All'}</Cell>
              <Cell>{amountText(c)}</Cell>
              <Cell>{c.minQty || '—'}</Cell>
              <Cell>{validityText(c)}</Cell>
              <Cell><StatusLight variant={statusOf(c, today).variant}>{statusOf(c, today).text}</StatusLight></Cell>
              <Cell><ActionButton isQuiet onPress={() => remove(c._id)}>Remove</ActionButton></Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
      <PriceTest api={api} customers={customers || []} products={products || []} salesOrgs={salesOrgs} onError={setActionError} />
    </Frame>
  )
}
