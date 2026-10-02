/*
 * What this order became. SAP calls it the document flow and puts it one click from the
 * order; Business Central heads the same idea Related documents.
 *
 * Each box is a number, a date and a status, and each opens that document: the order's
 * shipments, its invoice, then its return orders and credit memos. Before
 * anything follows, the strip says so — which is itself an ERP thing to see.
 */
import React from 'react'
import { StatusLight, Text } from '@adobe/react-spectrum'
import Card from './Card'
import { formatDate } from '../formatStamp'
import { money } from '../money'
import { returnStatusText, returnStatusLight } from './returnFormat'

/** One document in a flow: exported so a return order can draw its own flow from the same boxes. */
export function Box ({ kind, number, when, status, variant, onOpen, note }) {
  const title = `${kind} ${number || ''}`.trim()
  const body = (
    <>
      <span className='erp-doc-title'>{title}</span>
      <span className='erp-doc-meta'>{when}{note ? ` · ${note}` : ''}</span>
      <StatusLight variant={variant} marginStart='size-0'>{status}</StatusLight>
    </>
  )
  if (!onOpen) return <div className='erp-doc'>{body}</div>
  return <button type='button' className='erp-doc erp-doc-open' onClick={onOpen}>{body}</button>
}

/** "4 EA", or "2 lines" when the lines are in different units — never a sum of unlike things. */
function quantityNote (lines) {
  const units = new Set(lines.map((l) => l.unit))
  if (units.size === 1) return `${lines.reduce((sum, l) => sum + l.qty, 0)} ${lines[0].unit}`
  return `${lines.length} lines`
}

/** "3 returned": the quantity a return order takes back. */
const returnedNote = (r) => `${r.lines.reduce((sum, l) => sum + l.qty, 0)} returned`

export default function RelatedDocuments ({ order, onOpen }) {
  const shipments = order.shipments || []
  const invoice = order.invoice
  const returnOrders = order.returnOrders || []
  const creditMemos = order.creditMemos || []
  if (shipments.length === 0 && !invoice) {
    return (
      <Card title='Related Documents'>
        <Text>No related documents yet.</Text>
      </Card>
    )
  }
  return (
    <Card title='Related Documents'>
      <div className='erp-doc-flow'>
        <Box kind='Sales order' number={order.number} when={formatDate(order.createdAt)} status={order.overall} variant='info' />
        {shipments.map((s) => (
          <Box
            key={s.number}
            kind='Shipment'
            number={s.number}
            when={formatDate(s.postedAt || s.createdAt)}
            note={quantityNote(s.lines)}
            status={s.status === 'posted' ? 'Posted' : 'Open'}
            variant={s.status === 'posted' ? 'positive' : 'notice'}
            onOpen={onOpen && (() => onOpen('shipment', s.number))}
          />
        ))}
        {invoice && (invoice.legacy
          ? <Box kind='Invoice' when={formatDate(invoice.createdAt)} note='invoiced before invoice documents were kept' status='Invoiced' variant='positive' />
          : (
            <Box
              kind='Invoice'
              number={invoice.number}
              when={formatDate(invoice.createdAt)}
              status={invoice.status === 'credited' ? 'Credited' : 'Open'}
              variant='positive'
              onOpen={onOpen && (() => onOpen('invoice', invoice.number))}
            />
            ))}
        {/* After the invoice, what came back and what was credited (contract version 13). */}
        {returnOrders.map((r) => (
          <Box
            key={r.number}
            kind='Return order'
            number={r.number}
            when={formatDate(r.createdAt)}
            note={returnedNote(r)}
            status={returnStatusText(r)}
            variant={returnStatusLight(r)}
            onOpen={onOpen && (() => onOpen('return', r.number))}
          />
        ))}
        {creditMemos.map((m) => (
          <Box
            key={m.number}
            kind='Credit memo'
            number={m.number}
            when={formatDate(m.createdAt)}
            note={money(m.total, order.currency)}
            status='Posted'
            variant='positive'
            onOpen={onOpen && (() => onOpen('creditMemo', m.number))}
          />
        ))}
      </div>
    </Card>
  )
}
