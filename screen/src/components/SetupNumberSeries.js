/*
 * Settings → Number Series, as Business Central's No. Series lines: one row per document
 * type. The next number is edited in its cell and moves forward only; the ERP refuses a lower
 * one in words, shown as it said them (lib/counters checkNext).
 */
import React, { useState } from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell } from '@adobe/react-spectrum'
import Card from './Card'
import EditableText from './EditableText'
import { saveInPlace } from './saveInPlace'
import { seriesText } from './setupFormat'
import { useColumnWidths } from './columnWidths'
import { GRID_COLUMNS } from './gridColumns'

export default function SetupNumberSeries ({ series, onSave }) {
  const widths = useColumnWidths('numberSeries', GRID_COLUMNS.numberSeries)
  const [rows, setRows] = useState(series)
  const [saving, setSaving] = useState(null)

  function saveNext (row, next) {
    const before = rows
    return saveInPlace({
      show: () => { setRows(rows.map((r) => (r.type === row.type ? { ...r, next } : r))); setSaving(row.type) },
      send: () => onSave({ numberSeries: { [row.type]: { next } } }),
      settle: (setup) => { setRows(setup.numberSeries); setSaving(null) },
      undo: () => { setRows(before); setSaving(null) },
      saved: `Next ${seriesText(row.type).toLowerCase()} number saved`
    })
  }

  return (
    <Card title='Number Series'>
      <TableView {...widths.tableProps} aria-label='Number series' density='compact' overflowMode='wrap'>
        <TableHeader>
          <Column key='type' {...widths.columnProps('type')}>Document</Column>
          <Column key='starting' {...widths.columnProps('starting')}>Starting no.</Column>
          <Column key='next' {...widths.columnProps('next')}>Next no.</Column>
          <Column key='ending' {...widths.columnProps('ending')}>Ending no.</Column>
        </TableHeader>
        <TableBody items={rows.map((r) => ({ ...r, id: r.type }))}>
          {(r) => (
            <Row key={r.type}>
              <Cell>{seriesText(r.type)}</Cell>
              <Cell>{r.starting}</Cell>
              <Cell><EditableText value={r.next} label={`Next ${seriesText(r.type).toLowerCase()} number`} isSaving={saving === r.type} onSave={(next) => saveNext(r, next)} /></Cell>
              <Cell>{r.ending}</Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Card>
  )
}
