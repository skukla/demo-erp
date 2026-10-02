/*
 * Returns: the list of return orders. One is made from a Commerce return (the integration
 * sends it), so the list has no Add — it is where an SC finds the one to receive or to
 * credit. Choose a row to open the return order.
 */
import React, { useMemo, useState } from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, StatusLight, Picker, Item } from '@adobe/react-spectrum'
import Frame from './Frame'
import { useLoad } from './useLoad'
import { useColumnWidths } from './columnWidths'
import { useGridView, GridSearch } from './GridView'
import { useTrail, OpenDocument, useOpenFromQuery } from './Documents'
import { returnStatusText, returnStatusLight } from './returnFormat'
import { formatDate } from '../formatStamp'

const RETURN_COLUMNS = [
  { key: 'number', width: 160 },
  { key: 'date', width: 130 },
  { key: 'order', width: 150 },
  { key: 'partner', width: '2fr', minWidth: 200 },
  { key: 'lines', width: 100 },
  { key: 'status', width: 130 }
]

const soldTo = (r) => (r.partnerName ? `${r.partnerId} · ${r.partnerName}` : (r.partnerId || '—'))

const RETURN_GRID = {
  fields: [(r) => r.number, (r) => r.orderNumber, (r) => r.customerReturnReference, (r) => r.partnerId, (r) => r.partnerName, (r) => returnStatusText(r)],
  values: {
    number: (r) => r.number,
    date: (r) => Date.parse(r.createdAt) || 0,
    order: (r) => r.orderNumber,
    partner: (r) => r.partnerId || '',
    lines: (r) => r.lines.length,
    status: (r) => returnStatusText(r)
  },
  sort: { column: 'number', direction: 'descending' }
}

/* Home's cues land here: "Returns to receive" with ?work=open, "Returns to credit" with ?work=received. */
const SHOW = [
  { key: 'all', label: 'All return orders' },
  { key: 'open', label: 'To receive' },
  { key: 'received', label: 'To credit' },
  { key: 'credited', label: 'Credited' }
]
const showKey = (asked) => (SHOW.some((x) => x.key === asked) ? asked : 'all')

export default function Returns ({ api, query = {}, onChanged, onNavigate }) {
  const widths = useColumnWidths('returns', RETURN_COLUMNS)
  const { rows, error, reload } = useLoad(() => api.returns(), [api])
  const [show, setShow] = useState(() => showKey(query.work))
  const shown = useMemo(() => (!rows || show === 'all' ? rows : rows.filter((r) => r.status === show)), [rows, show])
  const view = useGridView(shown, RETURN_GRID)
  const trail = useTrail('Returns')
  useOpenFromQuery(trail, query, 'return')

  if (trail.top) {
    return <OpenDocument trail={trail} api={api} onChanged={onChanged} onNavigate={onNavigate} onClose={reload} />
  }

  return (
    <Frame title='Returns' error={error} loading={!rows}>
      <GridSearch placeholder='Return, order, customer return reference or customer' view={view}>
        <Picker aria-label='Status' label='Show' selectedKey={show} onSelectionChange={(k) => setShow(String(k))} items={SHOW}>
          {(x) => <Item key={x.key}>{x.label}</Item>}
        </Picker>
      </GridSearch>
      <TableView {...widths.tableProps} {...view.tableProps}
        aria-label='Returns' density='compact' overflowMode='wrap' marginTop='size-200'
        UNSAFE_className='erp-rows-open'
        selectionMode='none' onAction={(key) => trail.open('return', String(key))}>
        <TableHeader>
          <Column key='number' {...widths.columnProps('number')} allowsSorting>Return order</Column>
          <Column key='date' {...widths.columnProps('date')} allowsSorting>Created</Column>
          <Column key='order' {...widths.columnProps('order')} allowsSorting>Sales order</Column>
          <Column key='partner' {...widths.columnProps('partner')} allowsSorting>Sold-to</Column>
          <Column key='lines' {...widths.columnProps('lines')} align='end' allowsSorting>Lines</Column>
          <Column key='status' {...widths.columnProps('status')} allowsSorting>Status</Column>
        </TableHeader>
        <TableBody items={view.items}>
          {(r) => (
            <Row key={r.number}>
              <Cell><span className='erp-key'>{r.number}</span></Cell>
              <Cell>{formatDate(r.createdAt)}</Cell>
              <Cell>{r.orderNumber}</Cell>
              <Cell>{soldTo(r)}</Cell>
              <Cell>{r.lines.length}</Cell>
              <Cell><StatusLight variant={returnStatusLight(r)}>{returnStatusText(r)}</StatusLight></Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
