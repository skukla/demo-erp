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
 * rejected it, and Canceled). The hint under the strip belongs to the stage the order
 * stands at, and is offered only when the ERP says that move is open (`order.can`,
 * lib/return-moves) — the same rule the buttons on the title line read.
 */
import { money } from '../money.js'
import { returnMoves, canPayInvoice } from '../../../lib/return-moves.js'

const NOTHING_NEXT = 'Nothing more to do'
const SHIP_NEXT = 'Next: create a shipment for the open quantity'

/** The row with the greatest `key` (an ISO time), or null. */
const latest = (rows, key) => rows.reduce((best, r) => (r[key] && (!best || r[key] > best[key]) ? r : best), null)

/** The last time the order made this move, from its history. */
const lastMove = (order, status) => [...(order.history || [])].reverse().find((h) => h.status === status)

/** What `onOpen(kind, number)` needs to open a document, when the row is one. */
const docOf = (kind, row) => (row && row.number ? { kind, number: row.number } : undefined)

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
  if (order.header !== 'canceled') return { ...stage, attention: true, detail: 'On hold', hint: 'On credit hold: release or reject' }
  return order.cancelReason === 'Credit rejected' ? { ...stage, stopped: true, detail: 'Rejected' } : null
}

function confirmed (order, can) {
  const move = lastMove(order, 'confirmed')
  return {
    key: 'confirmed',
    label: 'Confirmed',
    done: order.header === 'confirmed' || Boolean(move),
    date: move && move.at,
    hint: can.confirm && 'Next: confirm the order'
  }
}

/** Done once the order has a shipment: the first delivery document exists. */
function delivery (order, can) {
  const shipments = order.shipments || []
  const { shipped, needed } = quantities(order)
  const first = shipments[0]
  // Every line closed and nothing shipped: no delivery will ever follow.
  const nothingToShip = needed === 0 && can.cancel && 'Nothing left to ship: cancel the order'
  return {
    key: 'delivery',
    label: 'Delivery created',
    done: shipments.length > 0 || shipped > 0,
    detail: shipments.length > 1 ? `${shipments.length} shipments` : undefined,
    date: first && first.createdAt,
    doc: docOf('shipment', first),
    hint: can.ship ? SHIP_NEXT : nothingToShip
  }
}

/** Done when everything that has to ship has been posted; until then it says how much has. */
function goodsIssue (order, can) {
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
    doc: docOf('shipment', done ? posted : waiting),
    hint: waiting ? `Next: post shipment ${waiting.number} (goods issue)` : (can.ship && SHIP_NEXT)
  }
}

function invoiced (order, can) {
  const invoice = order.invoice
  return {
    key: 'invoiced',
    label: 'Invoiced',
    done: Boolean(invoice),
    date: invoice && invoice.createdAt,
    doc: docOf('invoice', invoice),
    hint: can.invoice && 'Next: create the invoice'
  }
}

/**
 * Absent where no payment can follow: an invoice from before invoice documents were kept
 * (no number to pay against), and an invoice credited in full with nothing paid.
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
  return {
    ...stage,
    detail: status === 'partly paid' ? `Partly paid · ${open}` : open,
    hint: `Next: post the incoming payment on invoice ${invoice.number}`
  }
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
    hint: waiting && returnMoves(waiting).receive && `Next: receive return order ${waiting.number}`
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
    hint: waiting && `Next: post the credit memo for return order ${waiting.number}`
  }
}

/** The stage as the strip reads it: its state, and only the facts it has. */
function shown (stage, state) {
  const out = { key: stage.key, label: stage.label, state }
  for (const field of ['detail', 'date', 'doc']) if (stage[field]) out[field] = stage[field]
  return out
}

/** Give each stage its state: the first one not done is where the document stands, and its hint is the next move. */
function finish (stages) {
  let standing = null
  const out = stages.map((stage) => {
    if (stage.stopped) return shown(stage, 'stopped')
    if (stage.done) return shown(stage, 'done')
    if (standing) return shown(stage, 'upcoming')
    standing = stage
    return shown(stage, stage.attention ? 'attention' : 'current')
  })
  return { stages: out, nextHint: (standing && standing.hint) || NOTHING_NEXT }
}

/**
 * A sales order's process flow.
 *
 * @param {object} order the order as its document loads it (`api.order(number)`)
 * @returns {{ stages: { key: string, label: string, state: 'done'|'current'|'upcoming'|'attention'|'stopped', detail?: string, date?: string, doc?: { kind: string, number: string } }[], nextHint: string }}
 *   `date` is the stored ISO time; `doc` is what `onOpen(kind, number)` opens
 */
export function flowOf (order) {
  const can = order.can || {}
  const stages = [
    { key: 'received', label: 'Received', done: true, date: order.createdAt },
    creditCheck(order),
    confirmed(order, can),
    delivery(order, can),
    goodsIssue(order, can),
    invoiced(order, can),
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
 * A return order's process flow: created, the goods received, credited.
 *
 * @param {object} returnOrder the return order as its document loads it
 * @returns {{ stages: object[], nextHint: string }} the shape `flowOf` answers
 */
export function returnFlowOf (returnOrder) {
  const can = returnMoves(returnOrder)
  const memo = returnOrder.creditMemo
  return finish([
    { key: 'created', label: 'Return created', done: true, date: returnOrder.createdAt },
    { key: 'received', label: 'Goods received', done: returnOrder.status !== 'open', date: returnOrder.receivedAt, hint: can.receive && 'Next: receive the goods' },
    { key: 'credited', label: 'Credited', done: returnOrder.status === 'credited', date: memo && memo.createdAt, doc: docOf('creditMemo', memo), hint: can.credit && 'Next: post the credit memo' }
  ])
}
