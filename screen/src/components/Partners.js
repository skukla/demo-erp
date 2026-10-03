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
import { money, moneyOptions } from '../money'

// One object, not one per render: a Spectrum number field compares this by identity.
const MONEY = moneyOptions()

/* Wide enough for the header plus its sort chevron; see Orders.js. */
/* Name takes twice the slack of the two id columns beside it; the switch at the end
   takes none, which is why it is a fixed width. */
/* A credit limit with no exposure beside it says nothing (UI audit §Customers): Exposure
   and Available joined the list, and the Commerce company id moved to the document, where
   it is one fact among the customer's identity. Eight columns fit a 1,440px window. */
/* Credit limit 180 and Available 150, not 140 and 130: a cell is its width less 32 px of
   Spectrum's padding, and a cell clips what does not fit with "…" (AB-65). The credit limit's
   edit button for USD 120,000.00 is 131 px and was cut mid-digit; USD 118,713.60 available
   read "USD 118,71…". */
/* The headings clip too: Customer (sorted, so it carries the chevron) needs 133 px, Sales
   organizations 177, Payment terms 150, Credit block 137, measured 2026-10-03 when they read
   "CUSTO…", "SALES ORGANI…", "PAYMEN…". The room came from Name (its minimum 96: a long name
   wraps), Credit limit (172 still holds the 131 px button) and Credit block's empty slack. A
   heading only just fits; another column needs a shorter heading, not a narrower one. */
const PARTNER_COLUMNS = [
  { key: 'id', width: 136 },
  { key: 'name', width: '2fr', minWidth: 96 },
  { key: 'salesOrgs', width: '1fr', minWidth: 182 },
  { key: 'terms', width: 154 },
  { key: 'creditLimit', width: 172 },
  { key: 'exposure', width: 130 },
  { key: 'available', width: 150 },
  { key: 'blocking', width: 140 }
]

const PARTNER_GRID = {
  fields: [(p) => p.id, (p) => p.name],
  values: {
    id: (p) => p.id,
    name: (p) => p.name,
    salesOrgs: (p) => (p.salesOrgs || []).join(','),
    terms: (p) => p.paymentTerms || '',
    creditLimit: (p) => p.creditLimit || 0,
    exposure: (p) => p.exposure ?? -1,
    available: (p) => p.available ?? Number.NEGATIVE_INFINITY,
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
  const shown = useMemo(() => (rows && show === 'blocked' ? rows.filter((p) => (p.blocking && p.blocking !== 'open') || p.websiteAccount === 'closed') : rows), [rows, show])
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
          <Column key='salesOrgs' {...widths.columnProps('salesOrgs')} allowsSorting>Sales organizations</Column>
          <Column key='terms' {...widths.columnProps('terms')} allowsSorting>Payment terms</Column>
          <Column key='creditLimit' {...widths.columnProps('creditLimit')} align='end' allowsSorting>Credit limit</Column>
          <Column key='exposure' {...widths.columnProps('exposure')} align='end' allowsSorting>Exposure</Column>
          <Column key='available' {...widths.columnProps('available')} align='end' allowsSorting>Available</Column>
          <Column key='blocking' {...widths.columnProps('blocking')} allowsSorting>Credit block</Column>
        </TableHeader>
        <TableBody items={view.items}>
          {(p) => (
            <Row key={p.id}>
              <Cell><span className='erp-key'>{p.id}</span></Cell>
              {/* The default customer's stored name already says walk-in; no suffix. */}
              <Cell>{p.name}</Cell>
              <Cell>{salesOrgsText(p)}</Cell>
              <Cell>{p.paymentTerms}</Cell>
              <Cell><EditableNumber label='Credit limit' value={p.creditLimit} isSaving={p.saving === 'creditLimit'} step={100} formatOptions={MONEY} onSave={(v) => save(p.id, { creditLimit: v })} /></Cell>
              <Cell>{p.exposure === null || p.exposure === undefined ? '—' : money(p.exposure)}</Cell>
              <Cell>{p.available === null || p.available === undefined ? '—' : money(p.available)}</Cell>
              <Cell><StatusLight variant={p.blocking === 'open' ? 'neutral' : 'negative'}>{blockingText(p.blocking)}</StatusLight></Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
