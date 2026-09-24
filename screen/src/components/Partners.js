/*
 * Customers: the list. Choose a row to open the customer's document (CustomerDetail);
 * the credit limit can still be edited here, in the row, for a quick change while
 * preparing a demo. Blocking is a decision made on the document, where its four levels
 * can be read; here it is a badge.
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
import React, { useMemo, useState } from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, StatusLight, Picker, Item } from '@adobe/react-spectrum'
import Frame from './Frame'
import { useTrail, OpenDocument, useOpenFromQuery } from './Documents'
import { blockingText, salesOrgsText } from './CustomerDetail'
import EditableNumber from './EditableNumber'
import { saveInPlace } from './saveInPlace'
import { useLoad } from './useLoad'
import { useColumnWidths } from './columnWidths'
import { useGridView, GridSearch } from './GridView'
import { moneyOptions } from '../money'

// One object, not one per render: a Spectrum number field compares this by identity.
const MONEY = moneyOptions()

/* Wide enough for the header plus its sort chevron; see Orders.js. */
/* Name takes twice the slack of the two id columns beside it; the switch at the end
   takes none, which is why it is a fixed width. */
const PARTNER_COLUMNS = [
  { key: 'id', width: 150 },
  { key: 'name', width: '2fr', minWidth: 200 },
  { key: 'commerce', width: '1fr', minWidth: 195 },
  { key: 'salesOrgs', width: '1fr', minWidth: 190 },
  { key: 'terms', width: 165 },
  { key: 'creditLimit', width: 170 },
  { key: 'blocking', width: 210 }
]

const PARTNER_GRID = {
  fields: [(p) => p.id, (p) => p.name, (p) => p.commerceCompanyId],
  values: {
    id: (p) => p.id,
    name: (p) => p.name,
    commerce: (p) => p.commerceCompanyId || '',
    salesOrgs: (p) => (p.salesOrgs || []).join(','),
    terms: (p) => p.paymentTerms || '',
    creditLimit: (p) => p.creditLimit || 0,
    blocking: (p) => blockingText(p.blocking)
  },
  sort: { column: 'id', direction: 'ascending' }
}

const SHOW = [
  { key: 'all', label: 'All customers' },
  { key: 'blocked', label: 'Blocked' }
]

export default function Partners ({ api, query = {}, onChanged, onNavigate }) {
  const widths = useColumnWidths('partners', PARTNER_COLUMNS)
  const { rows, error, reload, updateRow } = useLoad(() => api.partners(), [api])
  // Home's "Blocked customers" lands here with ?work=blocked.
  const [show, setShow] = useState(() => (query.work === 'blocked' ? 'blocked' : 'all'))
  const shown = useMemo(() => (rows && show === 'blocked' ? rows.filter((p) => p.blocking && p.blocking !== 'open') : rows), [rows, show])
  const view = useGridView(shown, PARTNER_GRID)
  // The customer opened from the list, and the orders opened from the customer.
  const trail = useTrail('Customers')
  useOpenFromQuery(trail, query, 'customer')
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
  if (trail.top) {
    return <OpenDocument trail={trail} api={api} onChanged={onChanged} onNavigate={onNavigate} onClose={reload} />
  }

  return (
    <Frame title='Customers' error={error} loading={!rows}>
      <GridSearch placeholder='Customer, name or company' view={view}>
        <Picker aria-label='Blocking' label='Show' selectedKey={show} onSelectionChange={(k) => setShow(String(k))} items={SHOW}>
          {(x) => <Item key={x.key}>{x.label}</Item>}
        </Picker>
      </GridSearch>
      <TableView {...widths.tableProps} {...view.tableProps}
        aria-label='Customers' density='compact' overflowMode='wrap' marginTop='size-200'
        UNSAFE_className='erp-rows-open'
        selectionMode='none' onAction={(key) => { const row = (rows || []).find((p) => p.id === String(key)); trail.open('customer', String(key), row && row.name) }}>
        <TableHeader>
          <Column key='id' {...widths.columnProps('id')} allowsSorting>Customer</Column>
          <Column key='name' {...widths.columnProps('name')} allowsSorting>Name</Column>
          <Column key='commerce' {...widths.columnProps('commerce')} allowsSorting>Commerce company</Column>
          <Column key='salesOrgs' {...widths.columnProps('salesOrgs')} allowsSorting>Sales organisations</Column>
          <Column key='terms' {...widths.columnProps('terms')} allowsSorting>Payment terms</Column>
          <Column key='creditLimit' {...widths.columnProps('creditLimit')} align='end' allowsSorting>Credit limit</Column>
          <Column key='blocking' {...widths.columnProps('blocking')} allowsSorting>Blocking</Column>
        </TableHeader>
        <TableBody items={view.items}>
          {(p) => (
            <Row key={p.id}>
              <Cell><span className='erp-key'>{p.id}</span></Cell>
              {/* The default customer's stored name already says walk-in; no suffix. */}
              <Cell>{p.name}</Cell>
              <Cell>{p.commerceCompanyId || '—'}</Cell>
              <Cell>{salesOrgsText(p)}</Cell>
              <Cell>{p.paymentTerms}</Cell>
              <Cell><EditableNumber label='Credit limit' value={p.creditLimit} isSaving={p.saving === 'creditLimit'} step={100} formatOptions={MONEY} onSave={(v) => save(p.id, { creditLimit: v })} /></Cell>
              <Cell><StatusLight variant={p.blocking === 'open' ? 'neutral' : 'negative'}>{blockingText(p.blocking)}</StatusLight></Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
