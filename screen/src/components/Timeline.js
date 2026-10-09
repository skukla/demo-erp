/*
 * An order's timeline: what happened to it and when, oldest first — SAP's document flow
 * dates, Business Central's entries. The order stores its `history` (every status move,
 * with a reason where one was given) and shows it nowhere until now; its shipments and
 * invoice carry their own times, as do its payments, return orders and credit memos. This card merges them by time and links the documents.
 * A return order's own timeline is drawn by the same card (returnMomentsOf).
 */
import React from 'react'
import { Text } from '@adobe/react-spectrum'
import Card from './Card'
import { formatStamp } from '../formatStamp'

/** What each stored status move is called on the timeline. */
const MOVES = {
  created: 'Created',
  confirmed: 'Confirmed',
  canceled: 'Canceled',
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
    // Repeat order: the move names the other order, which opens.
    const other = h.order || h.repeatOf
    if (other) {
      moments.push({ at: h.at, text: h.order ? `Repeated as sales order ${other}` : `Created — repeat of sales order ${other}`, link: { kind: 'order', number: other } })
      continue
    }
    const said = h.reason ? `${what} — ${h.reason}` : what
    // A cancel removes the shipments waiting to be posted (contract version 21); the order no longer lists them, so this names them.
    const removed = h.removedShipments && h.removedShipments.length
      ? `${h.removedShipments.length > 1 ? 'Shipments' : 'Shipment'} ${h.removedShipments.join(', ')} removed: nothing had left.`
      : ''
    const told = [h.note, removed].filter(Boolean).join(' ')
    moments.push({ at: h.at, text: told ? `${said}. ${told}` : said })
  }
  for (const s of order.shipments || []) {
    moments.push({ at: s.createdAt, text: `Shipment ${s.number} created`, link: { kind: 'shipment', number: s.number } })
    if (s.postedAt) moments.push({ at: s.postedAt, text: `Shipment ${s.number} posted${s.warehouse ? ` from ${s.warehouse}` : ''}`, link: { kind: 'shipment', number: s.number } })
  }
  if (order.invoice && order.invoice.createdAt) {
    const number = order.invoice.number
    moments.push({ at: order.invoice.createdAt, text: number ? `Invoice ${number} created` : 'Invoiced (no invoice document)', ...(number ? { link: { kind: 'invoice', number } } : {}) })
  }
  for (const r of order.returnOrders || []) {
    const link = { kind: 'return', number: r.number }
    moments.push({ at: r.createdAt, text: `Return order ${r.number} created`, link })
    if (r.receivedAt) moments.push({ at: r.receivedAt, text: `Return order ${r.number} received`, link })
  }
  for (const p of order.payments || []) {
    moments.push({ at: p.createdAt, text: `Payment ${p.number} posted`, link: { kind: 'payment', number: p.number } })
  }
  for (const m of order.creditMemos || []) {
    moments.push({ at: m.createdAt, text: `Credit memo ${m.number} posted`, link: { kind: 'creditMemo', number: m.number } })
  }
  return byTime(moments)
}

/** A return order's moments: its own history (lib/returns), the credit memo linked. */
export function returnMomentsOf (returnOrder) {
  const moments = (returnOrder.history || []).map((h) => {
    if (h.status === 'credited' && h.creditMemo) return { at: h.at, text: `Credited by credit memo ${h.creditMemo}`, link: { kind: 'creditMemo', number: h.creditMemo } }
    return { at: h.at, text: RETURN_MOVES[h.status] || h.status }
  })
  return byTime(moments)
}

const RETURN_MOVES = { open: 'Created', received: 'Received — the goods are back in stock', credited: 'Credited' }

function byTime (moments) {
  return moments.filter((m) => m.at).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

/**
 * @param {object} props `order` for a sales order's timeline, or `moments` for any other
 *   document's; `onOpen(kind, number)` opens a linked document
 */
export default function Timeline ({ order, moments: given, onOpen }) {
  const moments = given || momentsOf(order)
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
