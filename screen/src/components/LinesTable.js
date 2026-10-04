/*
 * A document's lines: a sales order's, an invoice's, a credit memo's. Their columns change
 * with the document — Discount only when a line carries one (./lineDiscount.js), Close only
 * while a line can still be closed — so they are handed in, and the table is keyed on them:
 * Spectrum builds its column model once, and a Column that appears or disappears on a later
 * render needs a remount.
 *
 * Dynamic columns, not JSX children with a conditional among them: Spectrum's table builds
 * its collection from the children it is handed, and a `false` where a Column or Cell
 * should be leaves a hole it then reads (`isRowHeader` of undefined) and crashes.
 */
import React, { useMemo } from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell } from '@adobe/react-spectrum'
import { useColumnWidths } from './columnWidths'

/**
 * @param {string} tableId the grid's name in ./gridColumns.js, where its widths are kept
 * @param {string} label what a screen reader calls the table
 * @param {object[]} columns the columns, memoised: a new set starts the widths over
 * @param {object[]} lines the rows, each with an `item` number
 * @param {(line: object, key: string) => React.ReactNode} cell what a line shows in a column
 */
export default function LinesTable ({ tableId, label, columns, lines, cell }) {
  const widths = useColumnWidths(tableId, columns)
  // Spectrum keeps the Column it built for each item until the item itself changes, so a
  // drag that changes a width hands it new items; the same items kept every column where
  // it started (found 2026-10-03, driving a drag in the preview).
  const header = useMemo(() => columns.map((c) => ({ ...c })), [columns, widths.columnProps])
  // A button column comes first (gridColumns.js); the row is named by the column after it.
  const rowHeader = (columns.find((c) => c.holds !== 'action') || columns[0]).key
  return (
    <TableView
      key={columns.map((c) => c.key).join(',')}
      {...widths.tableProps}
      aria-label={label}
      density='compact'
      overflowMode='wrap'
    >
      <TableHeader columns={header}>
        {(c) => <Column key={c.key} {...widths.columnProps(c.key)} align={c.align} isRowHeader={c.key === rowHeader}>{c.label}</Column>}
      </TableHeader>
      <TableBody items={lines.map((l) => ({ ...l, id: l.item }))}>
        {(line) => (
          <Row key={line.item}>
            {(key) => <Cell>{cell(line, key)}</Cell>}
          </Row>
        )}
      </TableBody>
    </TableView>
  )
}
