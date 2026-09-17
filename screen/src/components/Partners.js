import React, { useState } from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, Switch } from '@adobe/react-spectrum'
import Frame from './Frame'
import EditableNumber from './EditableNumber'
import { toastSaved } from './toast'
import { useLoad } from './useLoad'
import { MIN_COLUMN_WIDTH, useColumnWidths } from './columnWidths'

const money = { style: 'currency', currency: 'USD' }

export default function Partners ({ api, onChanged }) {
  const widths = useColumnWidths('partners')
  const { rows, error, reload } = useLoad(() => api.partners(), [api])
  const [saveError, setSaveError] = useState(null)
  async function save (id, patch) {
    try { await api.patchPartner(id, patch); setSaveError(null); toastSaved('Business partner saved'); await reload(); onChanged() } catch (e) { setSaveError(e) }
  }
  return (
    <Frame title='Business partners' error={saveError || error} loading={!rows}>
      <TableView onResizeEnd={widths.onResizeEnd} aria-label='Business partners' density='compact' overflowMode='wrap'>
        <TableHeader>
          <Column key='id' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('id', 120)}>Partner</Column>
          <Column key='name' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('name')}>Name</Column>
          <Column key='commerce' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('commerce', 150)}>Commerce company</Column>
          <Column key='terms' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('terms', 100)}>Terms</Column>
          <Column key='creditLimit' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('creditLimit', 170)} align='end'>Credit limit</Column>
          <Column key='creditUsed' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('creditUsed', 140)} align='end'>Credit used</Column>
          <Column key='blocked' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('blocked', 110)}>Blocked</Column>
        </TableHeader>
        <TableBody items={rows || []}>
          {(p) => (
            <Row key={p.id}>
              <Cell>{p.id}</Cell>
              <Cell>{p.name}{p.isDefault ? ' (default)' : ''}</Cell>
              <Cell>{p.commerceCompanyId || '—'}</Cell>
              <Cell>{p.paymentTerms}</Cell>
              <Cell><EditableNumber label='Credit limit' value={p.creditLimit} step={100} formatOptions={money} onSave={(v) => save(p.id, { creditLimit: v })} /></Cell>
              <Cell>{new Intl.NumberFormat(undefined, money).format(p.creditUsed || 0)}</Cell>
              <Cell><Switch aria-label='Blocked' isSelected={Boolean(p.blocked)} onChange={(v) => save(p.id, { blocked: v })} /></Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
