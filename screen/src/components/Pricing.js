/*
 * Pricing conditions: the rules that decide what a customer pays.
 *
 * One full-width list of records. The form that used to stand beside it is a dialog
 * behind the page's own Add button, and the price test is a section underneath — the
 * two of them took a third of the screen permanently and left the rules squeezed into
 * what was left, which on a wide monitor was most of the page wasted.
 *
 * Remove stays on the row. The rule elsewhere is that a list does not act on records —
 * an order is acted on from its own document — but a condition has no document and
 * deleting a row from a small rules table is a table operation, not a workflow step.
 */
import React, { useState } from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, ActionButton } from '@adobe/react-spectrum'
import Frame from './Frame'
import AddCondition from './AddCondition'
import PriceTest from './PriceTest'
import { useLoad } from './useLoad'
import { toastSaved } from './toast'
import { useColumnWidths } from './columnWidths'
import { amountText, conditionOf, productText, soldToText } from './conditionFormat'

const CONDITION_COLUMNS = [
  { key: 'code', width: 130 },
  { key: 'label', width: '1fr', minWidth: 200 },
  { key: 'soldTo', width: '1fr', minWidth: 190 },
  { key: 'product', width: '1fr', minWidth: 190 },
  { key: 'amount', width: 150 },
  { key: 'remove', width: 120, resizable: false }
]

export default function Pricing ({ api, onChanged }) {
  const widths = useColumnWidths('pricing', CONDITION_COLUMNS)
  const { rows, error, reload } = useLoad(() => api.conditions(), [api])
  const [actionError, setActionError] = useState(null)

  async function add (condition) {
    try {
      await api.saveCondition(condition)
      setActionError(null)
      toastSaved('Pricing condition added')
      await reload()
      onChanged()
    } catch (e) { setActionError(e) }
  }

  async function remove (id) {
    try {
      await api.deleteCondition(id)
      setActionError(null)
      toastSaved('Pricing condition deleted')
      await reload()
      onChanged()
    } catch (e) { setActionError(e) }
  }

  return (
    <Frame
      title='Pricing conditions'
      error={actionError || error}
      loading={!rows}
      actions={<AddCondition onAdd={add} />}
    >
      <TableView {...widths.tableProps} aria-label='Pricing conditions' density='compact' overflowMode='wrap'>
        <TableHeader>
          <Column key='code' {...widths.columnProps('code')}>Condition</Column>
          <Column key='label' {...widths.columnProps('label')}>Description</Column>
          <Column key='soldTo' {...widths.columnProps('soldTo')}>Sold-to</Column>
          <Column key='product' {...widths.columnProps('product')}>Product</Column>
          <Column key='amount' {...widths.columnProps('amount')} align='end'>Amount</Column>
          <Column key='remove' {...widths.columnProps('remove')}> </Column>
        </TableHeader>
        <TableBody items={rows || []}>
          {(c) => (
            <Row key={c._id}>
              <Cell>{conditionOf(c.kind).code}</Cell>
              <Cell>{conditionOf(c.kind).label}</Cell>
              <Cell>{soldToText(c)}</Cell>
              <Cell>{productText(c)}</Cell>
              <Cell>{amountText(c)}</Cell>
              <Cell><ActionButton isQuiet onPress={() => remove(c._id)}>Remove</ActionButton></Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
      <PriceTest api={api} onError={setActionError} />
    </Frame>
  )
}
