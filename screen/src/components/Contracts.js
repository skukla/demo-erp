/*
 * Price Lists: the list. One row per customer price list (Business Central's sales price
 * lists), each applying to one customer or one customer price group; choose a row to open
 * it. New price list starts a draft and opens it, where its lines are added before anyone
 * activates it. (The record and route are `contracts`, the name the integration calls.)
 */
import React, { useMemo, useState } from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, StatusLight } from '@adobe/react-spectrum'
import Frame from './Frame'
import NewContract from './NewContract'
import { useLoad } from './useLoad'
import { useColumnWidths } from './columnWidths'
import { GRID_COLUMNS } from './gridColumns'
import { useGridView, GridSearch } from './GridView'
import { useTrail, OpenDocument, useOpenFromQuery } from './Documents'
import { toastSaved } from './toast'
import { appliesToText, contractStatus, termText } from './contractFormat'
import { todayIso } from './pricingRuleFormat'

const LIST_GRID = {
  fields: [(c) => c.number, (c) => c.partnerId, (c) => c.priceGroup, (c) => c.appliesToText, (c) => c.description],
  values: {
    number: (c) => c.number,
    appliesTo: (c) => c.appliesToText,
    description: (c) => c.description || '',
    term: (c) => c.startingDate || '',
    lines: (c) => (c.lines || []).length,
    status: (c) => c.status
  },
  sort: { column: 'number', direction: 'descending' }
}

const namesOf = (rows, key) => new Map((rows || []).map((r) => [r[key], r.name]))

export default function Contracts ({ api, query = {}, onChanged, onNavigate }) {
  const widths = useColumnWidths('contracts', GRID_COLUMNS.contracts)
  const { rows, error, reload } = useLoad(() => api.contracts(), [api])
  const { rows: customers } = useLoad(() => api.partners(), [api])
  const { rows: groups } = useLoad(() => api.priceGroups(), [api])
  const named = useMemo(() => {
    const [people, groupNames] = [namesOf(customers, 'id'), namesOf(groups, 'code')]
    return (rows || []).map((c) => ({ ...c, appliesToText: appliesToText(c, people, groupNames) }))
  }, [rows, customers, groups])
  const view = useGridView(rows ? named : null, LIST_GRID)
  const trail = useTrail('Price Lists')
  const [actionError, setActionError] = useState(null)
  const today = todayIso()
  useOpenFromQuery(trail, query, 'contract')

  async function create (draft) {
    try {
      const made = await api.createContract(draft)
      setActionError(null)
      toastSaved(`Price list ${made.number} created as a draft`)
      trail.open('contract', made.number)
    } catch (e) { setActionError(e) }
  }

  if (trail.top) {
    return <OpenDocument trail={trail} api={api} onChanged={onChanged} onNavigate={onNavigate} onClose={reload} />
  }

  return (
    <Frame
      title='Price Lists'
      error={actionError || error}
      loading={!rows}
      actions={<NewContract customers={customers || []} groups={groups || []} onCreate={create} />}
    >
      <GridSearch placeholder='Price list, customer, price group or description' view={view} />
      <TableView {...widths.tableProps} {...view.tableProps}
        aria-label='Price lists' density='compact' overflowMode='wrap' marginTop='size-200'
        UNSAFE_className='erp-rows-open'
        selectionMode='none' onAction={(key) => trail.open('contract', String(key))}>
        <TableHeader>
          <Column key='number' {...widths.columnProps('number')} allowsSorting>Price list</Column>
          <Column key='appliesTo' {...widths.columnProps('appliesTo')} allowsSorting>Applies to</Column>
          <Column key='description' {...widths.columnProps('description')} allowsSorting>Description</Column>
          <Column key='term' {...widths.columnProps('term')} allowsSorting>Term</Column>
          <Column key='lines' {...widths.columnProps('lines')} align='end' allowsSorting>Lines</Column>
          <Column key='status' {...widths.columnProps('status')} allowsSorting>Status</Column>
        </TableHeader>
        <TableBody items={view.items.map((c) => ({ ...c, id: c.number }))}>
          {(c) => (
            <Row key={c.number}>
              <Cell><span className='erp-key'>{c.number}</span></Cell>
              <Cell>{c.appliesToText}</Cell>
              <Cell>{c.description || '—'}</Cell>
              <Cell>{termText(c)}</Cell>
              <Cell>{(c.lines || []).length}</Cell>
              <Cell><StatusLight variant={contractStatus(c, today).variant}>{contractStatus(c, today).text}</StatusLight></Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
