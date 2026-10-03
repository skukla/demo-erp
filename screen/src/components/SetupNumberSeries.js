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

export default function SetupNumberSeries ({ series, onSave }) {
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
      <TableView aria-label='Number series' density='compact' overflowMode='wrap'>
        <TableHeader>
          <Column key='type' width='1fr' minWidth={110}>Document</Column>
          <Column key='starting' width={120}>Starting no.</Column>
          {/* 160, not 140 (AB-65): the cell is its width less 32 px of Spectrum's own padding, and
              a ten-digit number in its edit button is up to 113 px. At 140 the button was cut off,
              and a table cell marks a cut with "…" — whose first dot showed after the narrowest
              number (0000001010). The Document column gives up the 20 px. */}
          <Column key='next' width={160}>Next no.</Column>
          <Column key='ending' width={120}>Ending no.</Column>
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
