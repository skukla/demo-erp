/*
 * An order's timeline: what happened to it and when, oldest first — SAP's document flow
 * dates, Business Central's entries. The order stores its `history` (every status move,
 * with a reason where one was given) and shows it nowhere until now; its shipments and
 * invoice carry their own times. This card merges them by time and links the documents.
 */
import React from 'react'
import { Text } from '@adobe/react-spectrum'
import Card from './Card'
import { formatStamp } from '../formatStamp'

/** What each stored status move is called on the timeline. */
const MOVES = {
  created: 'Created',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  released: 'Credit hold released',
  held: 'Put on credit hold',
  shipped: 'Shipped',
  invoiced: 'Invoiced'
}

/** The order's moments, each `{ at, text, link? }`, oldest first. Exported for the tests. */
export function momentsOf (order) {
  const moments = []
  for (const h of order.history || []) {
    if (!h.at) continue
    const what = MOVES[h.status] || h.status
    moments.push({ at: h.at, text: h.reason ? `${what} — ${h.reason}` : what })
  }
  for (const s of order.shipments || []) {
    moments.push({ at: s.createdAt, text: `Shipment ${s.number} created`, link: { kind: 'shipment', number: s.number } })
    if (s.postedAt) moments.push({ at: s.postedAt, text: `Shipment ${s.number} posted${s.warehouse ? ` from ${s.warehouse}` : ''}`, link: { kind: 'shipment', number: s.number } })
  }
  if (order.invoice && order.invoice.createdAt) {
    const number = order.invoice.number
    moments.push({ at: order.invoice.createdAt, text: number ? `Invoice ${number} created` : 'Invoiced (no invoice document)', ...(number ? { link: { kind: 'invoice', number } } : {}) })
  }
  return moments.filter((m) => m.at).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

export default function Timeline ({ order, onOpen }) {
  const moments = momentsOf(order)
  if (moments.length === 0) return null
  return (
    <Card title='Timeline'>
      <ol className='erp-timeline'>
        {moments.map((m, i) => (
          <li key={`${m.at}:${m.text}:${i}`} className='erp-timeline-moment'>
            <Text UNSAFE_className='erp-timeline-when'>{formatStamp(m.at)}</Text>
            {m.link && onOpen
              ? <button type='button' className='erp-link' onClick={() => onOpen(m.link.kind, m.link.number)}>{m.text}</button>
              : <Text>{m.text}</Text>}
          </li>
        ))}
      </ol>
    </Card>
  )
}
