/*
 * Where a sales order stands in its process, as the stages the strip at the top of the
 * document draws (ProcessFlow.js) — SAP's process flow, Business Central's document status
 * bar. An ERP walks an order through more steps than the one status word says: received,
 * confirmed, a delivery created, its goods issue posted, invoiced, paid.
 *
 * Pure: everything is read from the order its own document already loads (lib/orders
 * describeOrder) — the header word, the quantities, `can`, the shipments, the invoice with
 * its open item, the payments, the return orders and the credit memos. Nothing is asked of
 * the ERP for the strip.
 *
 * Three stages appear only when the order has them: Credit check (it is or was on credit
 * hold), Returned and Credited (it has return orders or credit memos). A canceled order
 * keeps the stages it reached and ends at Canceled.
 *
 * A stage is `done`, `current` (where the order stands; the first stage not done),
 * `upcoming`, `attention` (it stands at a credit hold) or `stopped` (the credit check that
 * rejected it, and Canceled).
 *
 * The line under the strip is a link to the next move only when that move is made on
 * ANOTHER document and the page has no button for it — receive or credit this return order —
 * and is offered only when the ERP says the move is open (lib/return-moves). A move made by a
 * button on this page gets no line: the button is right above it. That includes Post shipment
 * and Post payment, which the order page offers itself although the shipment and the invoice
 * are where they happen (owner 2026-10-09: the order's main button is always the next step);
 * and Confirm, Create shipment, Release, Reject, Create invoice, Cancel, and on a return order
 * Receive and Post credit memo. Nor does an order with nothing left to do: a strip of ticks
 * says it.
 */
import { money } from '../money.js'
import { returnMoves, canPayInvoice } from '../../../lib/return-moves.js'

/** The row with the greatest `key` (an ISO time), or null. */
const latest = (rows, key) => rows.reduce((best, r) => (r[key] && (!best || r[key] > best[key]) ? r : best), null)

/** The last time the order made this move, from its history. */
const lastMove = (order, status) => [...(order.history || [])].reverse().find((h) => h.status === status)

/** What `onOpen(kind, number)` needs to open a document, when the row is one. */
const docOf = (kind, row) => (row && row.number ? { kind, number: row.number } : undefined)

/** The line under the strip: the next move, made on the document it opens. */
const link = (text, doc) => ({ text, doc })

/** What has shipped, and what has to ship: ordered less the quantities given up on. */
function quantities (order) {
  const sum = (key) => (order.lines || []).reduce((total, l) => total + (Number(l[key]) || 0), 0)
  return { shipped: sum('shippedQty'), needed: sum('qty') - sum('closedQty') }
}

/** Present only when the order is or was on credit hold. */
function creditCheck (order) {
  const credit = order.credit || {}
  const stage = { key: 'creditCheck', label: 'Credit check' }
  if (credit.status === 'released') return { ...stage, done: true, detail: 'Released', date: credit.decidedAt }
  if (credit.status !== 'held') return null
  if (order.header !== 'canceled') return { ...stage, attention: true, detail: 'On hold' }
  return order.cancelReason === 'Credit rejected' ? { ...stage, stopped: true, detail: 'Rejected' } : null
}

function confirmed (order) {
  const move = lastMove(order, 'confirmed')
  return { key: 'confirmed', label: 'Confirmed', done: order.header === 'confirmed' || Boolean(move), date: move && move.at }
}

/** Done once the order has a shipment: the first delivery document exists. */
function delivery (order) {
  const shipments = order.shipments || []
  const first = shipments[0]
  return {
    key: 'delivery',
    label: 'Delivery created',
    done: shipments.length > 0 || quantities(order).shipped > 0,
    detail: shipments.length > 1 ? `${shipments.length} shipments` : undefined,
    date: first && first.createdAt,
    doc: docOf('shipment', first)
  }
}

/**
 * Done when everything that has to ship has been posted; until then it says how much has.
 * A shipment created and not posted opens from the stage; posting it is the order page's
 * Post shipment button, so there is no line.
 */
function goodsIssue (order) {
  const shipments = order.shipments || []
  const { shipped, needed } = quantities(order)
  const done = shipped > 0 && shipped >= needed
  const waiting = shipments.find((s) => s.status !== 'posted')
  const posted = latest(shipments, 'postedAt')
  return {
    key: 'goodsIssue',
    label: 'Goods issued',
    done,
    detail: !done && shipped > 0 ? `${shipped} of ${needed} shipped` : undefined,
    date: done && posted ? posted.postedAt : undefined,
    doc: docOf('shipment', done ? posted : waiting)
  }
}

function invoiced (order) {
  const invoice = order.invoice
  return { key: 'invoiced', label: 'Invoiced', done: Boolean(invoice), date: invoice && invoice.createdAt, doc: docOf('invoice', invoice) }
}

/**
 * Absent where no payment can follow: an invoice from before invoice documents were kept
 * (no number to pay against), and an invoice credited in full with nothing paid. Posting the
 * payment is the order page's Post payment button, so there is no line.
 */
function paid (order) {
  const invoice = order.invoice
  const stage = { key: 'paid', label: 'Paid' }
  if (!invoice) return stage
  const payments = order.payments || []
  const status = invoice.paymentStatus
  if (!invoice.number || (status === 'credited' && payments.length === 0)) return null
  const last = latest(payments, 'createdAt')
  if (status === 'paid' || status === 'credited') return { ...stage, done: true, date: last && last.createdAt, doc: docOf('payment', last) }
  if (!canPayInvoice(invoice)) return stage
  const open = `${money(invoice.openAmount, order.currency)} open`
  return { ...stage, detail: status === 'partly paid' ? `Partly paid · ${open}` : open }
}

/** Present when the order has return orders; done when the goods of every one are back. */
function returned (order) {
  const returns = order.returnOrders || []
  if (returns.length === 0) return null
  const waiting = returns.find((r) => r.status === 'open')
  const back = returns.filter((r) => r.status !== 'open')
  const last = latest(back, 'receivedAt')
  return {
    key: 'returned',
    label: 'Returned',
    done: !waiting,
    detail: waiting && returns.length > 1 ? `${back.length} of ${returns.length} received` : undefined,
    date: !waiting && last ? last.receivedAt : undefined,
    doc: docOf('return', waiting || last),
    hint: waiting && returnMoves(waiting).receive ? link(`Next: receive return order ${waiting.number}`, docOf('return', waiting)) : undefined
  }
}

/** Present when the order has return orders or credit memos; done when nothing waits for its credit memo. */
function credited (order) {
  const returns = order.returnOrders || []
  const memos = order.creditMemos || []
  if (returns.length === 0 && memos.length === 0) return null
  const stage = { key: 'credited', label: 'Credited' }
  const settled = returns.filter((r) => r.status === 'credited')
  if (memos.length > 0 && settled.length === returns.length) {
    const last = latest(memos, 'createdAt')
    const total = memos.reduce((sum, m) => sum + (Number(m.total) || 0), 0)
    return { ...stage, done: true, detail: money(total, order.currency), date: last && last.createdAt, doc: docOf('creditMemo', last) }
  }
  const waiting = returns.find((r) => returnMoves(r).credit)
  return {
    ...stage,
    detail: returns.length > 1 ? `${settled.length} of ${returns.length} credited` : undefined,
    doc: docOf('return', waiting),
    hint: waiting && link(`Next: post the credit memo for return order ${waiting.number}`, docOf('return', waiting))
  }
}

/** The stage as the strip reads it: its state, and only the facts it has. */
function shown (stage, state) {
  const out = { key: stage.key, label: stage.label, state }
  for (const field of ['detail', 'date', 'doc']) if (stage[field]) out[field] = stage[field]
  return out
}

/** Give each stage its state: the first one not done is where the document stands, and its hint (if any) is the line. */
function finish (stages) {
  let standing = null
  const out = stages.map((stage) => {
    if (stage.stopped) return shown(stage, 'stopped')
    if (stage.done) return shown(stage, 'done')
    if (standing) return shown(stage, 'upcoming')
    standing = stage
    return shown(stage, stage.attention ? 'attention' : 'current')
  })
  return { stages: out, nextHint: (standing && standing.hint) || null }
}

/**
 * A sales order's process flow.
 *
 * @param {object} order the order as its document loads it (`api.order(number)`)
 * @returns {{ stages: { key: string, label: string, state: 'done'|'current'|'upcoming'|'attention'|'stopped', detail?: string, date?: string, doc?: { kind: string, number: string } }[], nextHint: { text: string, doc: { kind: string, number: string } } | null }}
 *   `date` is the stored ISO time; `doc` is what `onOpen(kind, number)` opens; `nextHint`
 *   is the next move when it is made on another document the page has no button for (a
 *   return order's), else null
 */
export function flowOf (order) {
  const stages = [
    { key: 'received', label: 'Received', done: true, date: order.createdAt },
    creditCheck(order),
    confirmed(order),
    delivery(order),
    goodsIssue(order),
    invoiced(order),
    paid(order),
    returned(order),
    credited(order)
  ].filter(Boolean)
  if (order.header !== 'canceled') return finish(stages)
  const move = lastMove(order, 'canceled')
  // Canceled replaces every stage the order never reached.
  const reached = stages.filter((s) => s.done || s.stopped)
  return finish([...reached, { key: 'canceled', label: 'Canceled', stopped: true, date: move && move.at }])
}

/**
 * A return order's process flow: created, the goods received, credited. Both moves are
 * buttons on the return order's own page, so it never has a line under the strip.
 *
 * @param {object} returnOrder the return order as its document loads it
 * @returns {{ stages: object[], nextHint: null }} the shape `flowOf` answers
 */
export function returnFlowOf (returnOrder) {
  const memo = returnOrder.creditMemo
  return finish([
    { key: 'created', label: 'Return created', done: true, date: returnOrder.createdAt },
    { key: 'received', label: 'Goods received', done: returnOrder.status !== 'open', date: returnOrder.receivedAt },
    { key: 'credited', label: 'Credited', done: returnOrder.status === 'credited', date: memo && memo.createdAt, doc: docOf('creditMemo', memo) }
  ])
}
