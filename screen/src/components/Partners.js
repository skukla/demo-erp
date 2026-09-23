/*
 * Customers: the list.
 *
 * The screen says "customer" because that is the word an SAP, Business Central or
 * NetSuite user reads without translating. The stored collection keeps its own name
 * (businessPartners), as does the API — renaming the data layer would be a migration
 * for no gain, and the partner idea survives on the document as "Partner type:
 * Sold-to".
 *
 * Credit used was removed here: it was written as zero and never changed again, so
 * every customer showed $0.00 beside a real credit limit. Real exposure is derived
 * from open orders, which needs order line quantities that do not exist yet.
 */
import React from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, Switch } from '@adobe/react-spectrum'
import Frame from './Frame'
import EditableNumber from './EditableNumber'
import SavingValue from './SavingValue'
import { saveInPlace } from './saveInPlace'
import { useLoad } from './useLoad'
import { useColumnWidths } from './columnWidths'
import { useGridView, GridSearch } from './GridView'

const money = { style: 'currency', currency: 'USD' }

/* Wide enough for the header plus its sort chevron; see Orders.js. */
const PARTNER_COLUMNS = [
  { key: 'id', width: 150 },
  { key: 'name' },
  { key: 'commerce', width: 195 },
  { key: 'salesOrg', width: 190 },
  { key: 'terms', width: 165 },
  { key: 'creditLimit', width: 170 },
  { key: 'blocked', width: 110 }
]

const PARTNER_GRID = {
  fields: [(p) => p.id, (p) => p.name, (p) => p.commerceCompanyId],
  values: {
    id: (p) => p.id,
    name: (p) => p.name,
    commerce: (p) => p.commerceCompanyId || '',
    salesOrg: (p) => p.salesOrg || '',
    terms: (p) => p.paymentTerms || '',
    creditLimit: (p) => p.creditLimit || 0,
    blocked: (p) => (p.blocked ? 'Blocked' : 'Open')
  },
  sort: { column: 'id', direction: 'ascending' }
}

export default function Partners ({ api, onChanged }) {
  const widths = useColumnWidths('partners', PARTNER_COLUMNS)
  const { rows, error, updateRow } = useLoad(() => api.partners(), [api])
  const view = useGridView(rows, PARTNER_GRID)
  function save (id, patch) {
    const isRow = (row) => row.id === id
    const before = rows.find(isRow)
    return saveInPlace({
      show: () => updateRow(isRow, (row) => ({ ...row, ...patch, saving: Object.keys(patch)[0] })),
      send: () => api.patchPartner(id, patch),
      settle: (answer) => { updateRow(isRow, () => answer); onChanged() },
      undo: () => updateRow(isRow, () => before),
      saved: 'Customer saved'
    })
  }
  return (
    <Frame title='Customers' error={error} loading={!rows}>
      <GridSearch placeholder='Customer, name or company' view={view} />
      <TableView {...widths.tableProps} {...view.tableProps} aria-label='Customers' density='compact' overflowMode='wrap' marginTop='size-200'>
        <TableHeader>
          <Column key='id' {...widths.columnProps('id')} allowsSorting>Customer</Column>
          <Column key='name' {...widths.columnProps('name')} allowsSorting>Name</Column>
          <Column key='commerce' {...widths.columnProps('commerce')} allowsSorting>Commerce company</Column>
          <Column key='salesOrg' {...widths.columnProps('salesOrg')} allowsSorting>Sales organisation</Column>
          <Column key='terms' {...widths.columnProps('terms')} allowsSorting>Payment terms</Column>
          <Column key='creditLimit' {...widths.columnProps('creditLimit')} align='end' allowsSorting>Credit limit</Column>
          <Column key='blocked' {...widths.columnProps('blocked')} allowsSorting>Blocked</Column>
        </TableHeader>
        <TableBody items={view.items}>
          {(p) => (
            <Row key={p.id}>
              <Cell>{p.id}</Cell>
              {/* The default customer's stored name already says walk-in; no suffix. */}
              <Cell>{p.name}</Cell>
              <Cell>{p.commerceCompanyId || '—'}</Cell>
              <Cell>{p.salesOrg || '—'}</Cell>
              <Cell>{p.paymentTerms}</Cell>
              <Cell><EditableNumber label='Credit limit' value={p.creditLimit} isSaving={p.saving === 'creditLimit'} step={100} formatOptions={money} onSave={(v) => save(p.id, { creditLimit: v })} /></Cell>
              <Cell><SavingValue isSaving={p.saving === 'blocked'}><Switch aria-label='Blocked' isSelected={Boolean(p.blocked)} onChange={(v) => save(p.id, { blocked: v })} /></SavingValue></Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
