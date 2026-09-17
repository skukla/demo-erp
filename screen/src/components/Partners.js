import React from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, Switch } from '@adobe/react-spectrum'
import Frame from './Frame'
import EditableNumber from './EditableNumber'
import SavingValue from './SavingValue'
import { saveInPlace } from './saveInPlace'
import { useLoad } from './useLoad'
import { useColumnWidths } from './columnWidths'

const money = { style: 'currency', currency: 'USD' }

const PARTNER_COLUMNS = [
  { key: 'id', width: 120 },
  { key: 'name' },
  { key: 'commerce', width: 150 },
  { key: 'terms', width: 100 },
  { key: 'creditLimit', width: 170 },
  { key: 'creditUsed', width: 140 },
  { key: 'blocked', width: 110 }
]

export default function Partners ({ api, onChanged }) {
  const widths = useColumnWidths('partners', PARTNER_COLUMNS)
  const { rows, error, updateRow } = useLoad(() => api.partners(), [api])
  function save (id, patch) {
    const isRow = (row) => row.id === id
    const before = rows.find(isRow)
    return saveInPlace({
      show: () => updateRow(isRow, (row) => ({ ...row, ...patch, saving: Object.keys(patch)[0] })),
      send: () => api.patchPartner(id, patch),
      settle: (answer) => { updateRow(isRow, () => answer); onChanged() },
      undo: () => updateRow(isRow, () => before),
      saved: 'Business partner saved'
    })
  }
  return (
    <Frame title='Business partners' error={error} loading={!rows}>
      <TableView {...widths.tableProps} aria-label='Business partners' density='compact' overflowMode='wrap'>
        <TableHeader>
          <Column key='id' {...widths.columnProps('id')}>Partner</Column>
          <Column key='name' {...widths.columnProps('name')}>Name</Column>
          <Column key='commerce' {...widths.columnProps('commerce')}>Commerce company</Column>
          <Column key='terms' {...widths.columnProps('terms')}>Terms</Column>
          <Column key='creditLimit' {...widths.columnProps('creditLimit')} align='end'>Credit limit</Column>
          <Column key='creditUsed' {...widths.columnProps('creditUsed')} align='end'>Credit used</Column>
          <Column key='blocked' {...widths.columnProps('blocked')}>Blocked</Column>
        </TableHeader>
        <TableBody items={rows || []}>
          {(p) => (
            <Row key={p.id}>
              <Cell>{p.id}</Cell>
              <Cell>{p.name}{p.isDefault ? ' (default)' : ''}</Cell>
              <Cell>{p.commerceCompanyId || '—'}</Cell>
              <Cell>{p.paymentTerms}</Cell>
              <Cell><EditableNumber label='Credit limit' value={p.creditLimit} isSaving={p.saving === 'creditLimit'} step={100} formatOptions={money} onSave={(v) => save(p.id, { creditLimit: v })} /></Cell>
              <Cell>{new Intl.NumberFormat(undefined, money).format(p.creditUsed || 0)}</Cell>
              <Cell><SavingValue isSaving={p.saving === 'blocked'}><Switch aria-label='Blocked' isSelected={Boolean(p.blocked)} onChange={(v) => save(p.id, { blocked: v })} /></SavingValue></Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
