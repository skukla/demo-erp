/*
 * What this order became. SAP calls it the document flow and puts it one click from the
 * order; Business Central heads the same idea Related documents.
 *
 * Each box is a number, a date and a status, and each opens that document. Before
 * anything follows, the strip says so — which is itself an ERP thing to see.
 */
import React from 'react'
import { StatusLight, Text } from '@adobe/react-spectrum'
import Card from './Card'
import { formatDate } from '../formatStamp'

function Box ({ kind, number, when, status, variant, onOpen, note }) {
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

export default function RelatedDocuments ({ order, onOpen }) {
  const shipments = order.shipments || []
  const invoice = order.invoice
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
          ? <Box kind='Invoice' when={formatDate(invoice.createdAt)} note='invoiced in Commerce before the ERP kept invoice documents' status='Invoiced' variant='positive' />
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
      </div>
    </Card>
  )
}
