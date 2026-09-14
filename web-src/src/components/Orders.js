import React, { useState } from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, ActionGroup, Item, StatusLight } from '@adobe/react-spectrum'
import Frame from './Frame'
import { useLoad } from './useLoad'

const NEXT = { created: ['confirmed', 'cancelled'], confirmed: ['shipped', 'cancelled'], shipped: ['invoiced'], invoiced: [], cancelled: [] }
const LIGHT = { created: 'neutral', confirmed: 'info', shipped: 'notice', invoiced: 'positive', cancelled: 'negative' }
const money = (o) => new Intl.NumberFormat(undefined, { style: 'currency', currency: o.currency || 'USD' }).format(o.total || 0)

export default function Orders ({ api, onChanged }) {
  const { rows, error, reload } = useLoad(() => api.orders(), [api])
  const [moveError, setMoveError] = useState(null)
  async function move (number, status) {
    try { await api.moveOrder(number, status); setMoveError(null); await reload(); onChanged() } catch (e) { setMoveError(e) }
  }
  return (
    <Frame title='Sales orders' error={moveError || error} loading={!rows}>
      <TableView aria-label='Sales orders' density='compact' overflowMode='wrap'>
        <TableHeader>
          <Column key='number' width={140}>Sales order</Column>
          <Column key='commerce' width={150}>Commerce order</Column>
          <Column key='partner' width={110}>Partner</Column>
          <Column key='lines' width={80} align='end'>Lines</Column>
          <Column key='total' width={130} align='end'>Total</Column>
          <Column key='status' width={140}>Status</Column>
          <Column key='actions'>Move to</Column>
        </TableHeader>
        <TableBody items={rows || []}>
          {(o) => (
            <Row key={o.number}>
              <Cell>{o.number}</Cell>
              <Cell>{o.commerceIncrementId || o.commerceOrderId}</Cell>
              <Cell>{o.partnerId || '—'}</Cell>
              <Cell>{(o.lines || []).length}</Cell>
              <Cell>{money(o)}</Cell>
              <Cell><StatusLight variant={LIGHT[o.status] || 'neutral'}>{o.status}</StatusLight></Cell>
              <Cell>
                {(NEXT[o.status] || []).length > 0 && (
                  <ActionGroup density='compact' onAction={(key) => move(o.number, String(key))}>
                    {(NEXT[o.status] || []).map((s) => <Item key={s}>{s}</Item>)}
                  </ActionGroup>
                )}
              </Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
