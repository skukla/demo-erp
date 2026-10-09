/*
 * The process flow strip at the top of a sales order and of a return order: which stages
 * the document shows, where it stands in them, and the one line that links to the next
 * move when it happens on another document (screen/src/components/orderFlow.js). When the
 * next move is a button on this page, or there is none, the line is null: the buttons and
 * the strip already say it.
 *
 * Each order here is the order as its own document loads it (lib/orders describeOrder):
 * the header word, the lines with their quantities, `can`, the shipments, the invoice with
 * its open item, the payments, the return orders and the credit memos.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')

const load = () => import('../screen/src/components/orderFlow.js')

const NB = '\u00a0' // the non-breaking space Intl puts between a currency code and its figure
const at = (day, hour = 9) => `2026-09-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`

const NO_MOVES = { confirm: false, ship: false, post: false, close: false, invoice: false, pay: false, cancel: false, release: false, reject: false }

/** A new order of two of one product, as the document loads it; `over` changes what a test is about. */
function order (over = {}) {
  return {
    number: '0000002001',
    header: 'created',
    currency: 'USD',
    createdAt: at(1),
    lines: [{ item: 10, sku: 'P1', qty: 2, shippedQty: 0, closedQty: 0 }],
    history: [{ status: 'created', at: at(1) }],
    credit: { status: 'approved', reason: null, decidedAt: null },
    can: { ...NO_MOVES, confirm: true, cancel: true },
    shipments: [],
    invoice: null,
    payments: [],
    returnOrders: [],
    creditMemos: [],
    ...over
  }
}

const confirmed = (over = {}) => order({
  header: 'confirmed',
  history: [{ status: 'created', at: at(1) }, { status: 'confirmed', at: at(2) }],
  can: { ...NO_MOVES, ship: true, close: true, cancel: true },
  ...over
})

const shipment = (number, qty, postedAt = null) => ({ number, createdAt: at(3), postedAt, status: postedAt ? 'posted' : 'open', lines: [{ item: 10, sku: 'P1', qty }] })

/** Both units shipped by one posted shipment. */
const shipped = (over = {}) => confirmed({
  lines: [{ item: 10, sku: 'P1', qty: 2, shippedQty: 2, closedQty: 0 }],
  shipments: [shipment('8000000012', 2, at(4))],
  can: { ...NO_MOVES, invoice: true },
  ...over
})

const invoiced = (openItem = {}, over = {}) => shipped({
  invoice: { number: '9000000011', createdAt: at(5), status: 'open', total: 274.86, openAmount: 274.86, paidAmount: 0, paymentStatus: 'open', ...openItem },
  can: { ...NO_MOVES, pay: true },
  ...over
})

const payment = (number, amount, day) => ({ number, createdAt: at(day), amount, currency: 'USD' })
const paid = (over = {}) => invoiced({ openAmount: 0, paidAmount: 274.86, paymentStatus: 'paid' }, { payments: [payment('7000000005', 274.86, 6)], can: { ...NO_MOVES }, ...over })

const keys = (flow) => flow.stages.map((s) => s.key)
const states = (flow) => flow.stages.map((s) => s.state)
const stage = (flow, key) => flow.stages.find((s) => s.key === key)
const MAIN = ['received', 'confirmed', 'delivery', 'goodsIssue', 'invoiced', 'paid']

test('a new order: received, and waiting to be confirmed; no hint, Confirm is on this page', async () => {
  const { flowOf } = await load()
  const flow = flowOf(order())
  assert.deepEqual(keys(flow), MAIN)
  assert.deepEqual(flow.stages.map((s) => s.label), ['Received', 'Confirmed', 'Delivery created', 'Goods issued', 'Invoiced', 'Paid'])
  assert.deepEqual(states(flow), ['done', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming'])
  assert.equal(stage(flow, 'received').date, at(1))
  assert.equal(flow.nextHint, null)
})

test('a confirmed order: confirmed on its date, and waiting for a shipment; no hint, Create shipment is on this page', async () => {
  const { flowOf } = await load()
  const flow = flowOf(confirmed())
  assert.deepEqual(states(flow), ['done', 'done', 'current', 'upcoming', 'upcoming', 'upcoming'])
  assert.equal(stage(flow, 'confirmed').date, at(2))
  assert.equal(flow.nextHint, null)
})

test('a shipment created and not posted: the delivery is done and opens; no hint, Post shipment is on this page', async () => {
  const { flowOf } = await load()
  const flow = flowOf(confirmed({ shipments: [shipment('8000000012', 2)], can: { ...NO_MOVES, post: '8000000012', close: true } }))
  assert.deepEqual(states(flow), ['done', 'done', 'done', 'current', 'upcoming', 'upcoming'])
  assert.equal(stage(flow, 'delivery').date, at(3))
  assert.deepEqual(stage(flow, 'delivery').doc, { kind: 'shipment', number: '8000000012' })
  assert.deepEqual(stage(flow, 'goodsIssue').doc, { kind: 'shipment', number: '8000000012' })
  // The order page's main button posts it (owner 2026-10-09): the line would say it twice.
  assert.equal(flow.nextHint, null)
})

test('a partly shipped order says how much has shipped, and asks for the rest', async () => {
  const { flowOf } = await load()
  const flow = flowOf(confirmed({
    lines: [{ item: 10, sku: 'P1', qty: 2, shippedQty: 1, closedQty: 0 }],
    shipments: [shipment('8000000012', 1, at(4))]
  }))
  assert.deepEqual(states(flow), ['done', 'done', 'done', 'current', 'upcoming', 'upcoming'])
  assert.equal(stage(flow, 'goodsIssue').detail, '1 of 2 shipped')
  assert.equal(flow.nextHint, null)
})

test('a closed quantity is not waited for: what was not closed has shipped, so the goods issue is done', async () => {
  const { flowOf } = await load()
  const flow = flowOf(shipped({
    lines: [{ item: 10, sku: 'P1', qty: 2, shippedQty: 1, closedQty: 1 }],
    shipments: [shipment('8000000012', 1, at(4))]
  }))
  assert.equal(stage(flow, 'goodsIssue').state, 'done')
  assert.equal(stage(flow, 'goodsIssue').detail, undefined)
})

test('a fully shipped order: goods issued on the posting date; no hint, Create invoice is on this page', async () => {
  const { flowOf } = await load()
  const flow = flowOf(shipped())
  assert.deepEqual(states(flow), ['done', 'done', 'done', 'done', 'current', 'upcoming'])
  assert.equal(stage(flow, 'goodsIssue').date, at(4))
  assert.deepEqual(stage(flow, 'goodsIssue').doc, { kind: 'shipment', number: '8000000012' })
  assert.equal(flow.nextHint, null)
})

test('an invoiced order: the invoice opens, Paid says what is open; no hint, Post payment is on this page', async () => {
  const { flowOf } = await load()
  const flow = flowOf(invoiced())
  assert.deepEqual(states(flow), ['done', 'done', 'done', 'done', 'done', 'current'])
  assert.equal(stage(flow, 'invoiced').date, at(5))
  assert.deepEqual(stage(flow, 'invoiced').doc, { kind: 'invoice', number: '9000000011' })
  assert.equal(stage(flow, 'paid').detail, `USD${NB}274.86 open`)
  assert.equal(flow.nextHint, null)
})

test('a partly paid invoice says so with the open amount, and still waits for payment', async () => {
  const { flowOf } = await load()
  const flow = flowOf(invoiced({ openAmount: 174.86, paidAmount: 100, paymentStatus: 'partly paid' }, { payments: [payment('7000000004', 100, 6)] }))
  assert.equal(stage(flow, 'paid').state, 'current')
  assert.equal(stage(flow, 'paid').detail, `Partly paid · USD${NB}174.86 open`)
  assert.equal(flow.nextHint, null)
})

test('a paid order: every stage done, the last payment opens, no hint', async () => {
  const { flowOf } = await load()
  const flow = flowOf(paid({ payments: [payment('7000000004', 100, 6), payment('7000000005', 174.86, 7)] }))
  assert.deepEqual(states(flow), ['done', 'done', 'done', 'done', 'done', 'done'])
  assert.equal(stage(flow, 'paid').date, at(7))
  assert.deepEqual(stage(flow, 'paid').doc, { kind: 'payment', number: '7000000005' })
  assert.equal(flow.nextHint, null)
})

test('an order on credit hold shows a credit check that needs attention, before Confirmed; no hint, Release and Reject are on this page', async () => {
  const { flowOf } = await load()
  const flow = flowOf(order({
    credit: { status: 'held', reason: 'Credit limit 80,000.00 exceeded by 1,240.00', decidedAt: null },
    history: [{ status: 'created', at: at(1) }, { status: 'held', at: at(1), reason: 'Credit limit 80,000.00 exceeded by 1,240.00' }],
    can: { ...NO_MOVES, cancel: true, release: true, reject: true }
  }))
  assert.deepEqual(keys(flow), ['received', 'creditCheck', 'confirmed', 'delivery', 'goodsIssue', 'invoiced', 'paid'])
  assert.deepEqual(states(flow), ['done', 'attention', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming'])
  assert.equal(stage(flow, 'creditCheck').label, 'Credit check')
  assert.equal(stage(flow, 'creditCheck').detail, 'On hold')
  assert.equal(flow.nextHint, null)
})

test('a released order keeps its credit check, done on the day it was released', async () => {
  const { flowOf } = await load()
  const flow = flowOf(order({ credit: { status: 'released', reason: 'Overdue balance 12.00', decidedAt: at(2) } }))
  assert.deepEqual(states(flow).slice(0, 3), ['done', 'done', 'current'])
  assert.equal(stage(flow, 'creditCheck').detail, 'Released')
  assert.equal(stage(flow, 'creditCheck').date, at(2))
  assert.equal(flow.nextHint, null)
})

test('an order with no credit hold shows no credit check', async () => {
  const { flowOf } = await load()
  assert.equal(stage(flowOf(order()), 'creditCheck'), undefined)
  assert.equal(stage(flowOf(order({ credit: null })), 'creditCheck'), undefined)
})

test('a rejected order: the credit check stopped it, and Canceled replaces every stage that never happened', async () => {
  const { flowOf } = await load()
  const flow = flowOf(order({
    header: 'canceled',
    cancelReason: 'Credit rejected',
    credit: { status: 'held', reason: 'Overdue balance 12.00', decidedAt: at(2) },
    history: [{ status: 'created', at: at(1) }, { status: 'held', at: at(1) }, { status: 'canceled', at: at(2), reason: 'Credit rejected' }],
    can: { ...NO_MOVES }
  }))
  assert.deepEqual(keys(flow), ['received', 'creditCheck', 'canceled'])
  assert.deepEqual(states(flow), ['done', 'stopped', 'stopped'])
  assert.equal(stage(flow, 'creditCheck').detail, 'Rejected')
  assert.equal(stage(flow, 'canceled').label, 'Canceled')
  assert.equal(stage(flow, 'canceled').date, at(2))
  assert.equal(flow.nextHint, null)
})

test('an order canceled after it was confirmed keeps Confirmed, then ends at Canceled', async () => {
  const { flowOf } = await load()
  const flow = flowOf(confirmed({
    header: 'canceled',
    cancelReason: 'Customer request',
    history: [{ status: 'created', at: at(1) }, { status: 'confirmed', at: at(2) }, { status: 'canceled', at: at(3), reason: 'Customer request' }],
    can: { ...NO_MOVES }
  }))
  assert.deepEqual(keys(flow), ['received', 'confirmed', 'canceled'])
  assert.deepEqual(states(flow), ['done', 'done', 'stopped'])
  assert.equal(flow.nextHint, null)
})

const returnOrder = (number, status, over = {}) => ({ number, status, createdAt: at(8), receivedAt: status === 'open' ? null : at(9), creditMemo: null, lines: [{ item: 10, sku: 'P1', qty: 1 }], ...over })
const memo = (number, total, day) => ({ number, createdAt: at(day), total })

test('an order with no returns and no credit memos shows neither Returned nor Credited', async () => {
  const { flowOf } = await load()
  assert.deepEqual(keys(flowOf(paid())), MAIN)
})

test('an open return order: Returned waits for the goods, and the hint links to that return', async () => {
  const { flowOf } = await load()
  const flow = flowOf(paid({ returnOrders: [returnOrder('6000000007', 'open')] }))
  assert.deepEqual(keys(flow), [...MAIN, 'returned', 'credited'])
  assert.deepEqual(states(flow).slice(-2), ['current', 'upcoming'])
  assert.deepEqual(stage(flow, 'returned').doc, { kind: 'return', number: '6000000007' })
  assert.deepEqual(flow.nextHint, { text: 'Next: receive return order 6000000007', doc: { kind: 'return', number: '6000000007' } })
})

test('a received return: Returned is done on the day the goods came back; the hint links to the return to credit', async () => {
  const { flowOf } = await load()
  const flow = flowOf(paid({ returnOrders: [returnOrder('6000000007', 'received')] }))
  assert.deepEqual(states(flow).slice(-2), ['done', 'current'])
  assert.equal(stage(flow, 'returned').date, at(9))
  assert.deepEqual(stage(flow, 'returned').doc, { kind: 'return', number: '6000000007' })
  assert.deepEqual(stage(flow, 'credited').doc, { kind: 'return', number: '6000000007' })
  assert.deepEqual(flow.nextHint, { text: 'Next: post the credit memo for return order 6000000007', doc: { kind: 'return', number: '6000000007' } })
})

test('a credited return: Credited is done, shows the amount and opens the credit memo', async () => {
  const { flowOf } = await load()
  const credit = memo('9500000004', 96.34, 10)
  const flow = flowOf(paid({ returnOrders: [returnOrder('6000000007', 'credited', { creditMemo: credit })], creditMemos: [credit] }))
  assert.deepEqual(states(flow).slice(-2), ['done', 'done'])
  assert.equal(stage(flow, 'credited').date, at(10))
  assert.equal(stage(flow, 'credited').detail, `USD${NB}96.34`)
  assert.deepEqual(stage(flow, 'credited').doc, { kind: 'creditMemo', number: '9500000004' })
  assert.equal(flow.nextHint, null)
})

test('several returns in different states are counted in words under each stage', async () => {
  const { flowOf } = await load()
  const credit = memo('9500000004', 96.34, 10)
  const flow = flowOf(paid({
    returnOrders: [returnOrder('6000000007', 'credited', { creditMemo: credit }), returnOrder('6000000008', 'received'), returnOrder('6000000009', 'open')],
    creditMemos: [credit]
  }))
  assert.equal(stage(flow, 'returned').detail, '2 of 3 received')
  assert.equal(stage(flow, 'credited').detail, '1 of 3 credited')
  assert.deepEqual(flow.nextHint, { text: 'Next: receive return order 6000000009', doc: { kind: 'return', number: '6000000009' } })
})

test('an invoice credited in full with nothing paid: Credited follows Invoiced, and no payment is waited for', async () => {
  const { flowOf } = await load()
  const credit = memo('9500000002', 274.86, 6)
  const flow = flowOf(invoiced({ status: 'credited', creditMemo: credit.number, openAmount: 0, paymentStatus: 'credited' }, { creditMemos: [credit] }))
  assert.deepEqual(keys(flow), ['received', 'confirmed', 'delivery', 'goodsIssue', 'invoiced', 'credited'])
  assert.deepEqual(states(flow), ['done', 'done', 'done', 'done', 'done', 'done'])
  assert.equal(flow.nextHint, null)
})

test('an invoice from before invoice documents were kept: Invoiced with no document to open, and no Paid stage', async () => {
  const { flowOf } = await load()
  const flow = flowOf(shipped({ shipments: [], invoice: { number: null, legacy: true, createdAt: at(5), status: 'open' }, can: { ...NO_MOVES } }))
  assert.deepEqual(keys(flow), ['received', 'confirmed', 'delivery', 'goodsIssue', 'invoiced'])
  assert.equal(stage(flow, 'invoiced').doc, undefined)
  assert.equal(stage(flow, 'delivery').state, 'done')
  assert.equal(flow.nextHint, null)
})

test('at most one stage is where the order stands, whatever its state', async () => {
  const { flowOf } = await load()
  const standing = (o) => flowOf(o).stages.filter((s) => s.state === 'current' || s.state === 'attention').length
  for (const o of [order(), confirmed(), shipped(), invoiced(), paid({ returnOrders: [returnOrder('6000000009', 'open')] })]) assert.equal(standing(o), 1)
  for (const o of [paid(), confirmed({ header: 'canceled', can: { ...NO_MOVES } })]) assert.equal(standing(o), 0)
})

test('a hint is offered only for a move made on another document, and names that document', async () => {
  const { flowOf, returnFlowOf } = await load()
  // Posting a shipment and posting a payment are buttons on the order page too (owner 2026-10-09).
  for (const o of [order(), confirmed(), confirmed({ shipments: [shipment('8000000012', 2)] }), shipped(), invoiced(), paid()]) assert.equal(flowOf(o).nextHint, null)
  assert.equal(returnFlowOf(returnOrder('6000000007', 'open')).nextHint, null)
  const hint = flowOf(paid({ returnOrders: [returnOrder('6000000007', 'open')] })).nextHint
  assert.match(hint.text, /^Next: /)
  assert.deepEqual(Object.keys(hint).sort(), ['doc', 'text'])
})

test('the strip speaks as an ERP: no word of a web shop, even when the cancellation reason has one', async () => {
  const { flowOf } = await load()
  const flow = flowOf(order({
    header: 'canceled',
    cancelReason: 'Canceled in the web shop',
    history: [{ status: 'created', at: at(1) }, { status: 'canceled', at: at(2), reason: 'Canceled in the web shop' }],
    can: { ...NO_MOVES }
  }))
  assert.doesNotMatch(JSON.stringify(flow), /shop|commerce|storefront/i)
})

test('a return order has its own three stages: created, goods received, credited; its moves are on its page, so no hint', async () => {
  const { returnFlowOf } = await load()
  const open = returnFlowOf(returnOrder('6000000007', 'open'))
  assert.deepEqual(open.stages.map((s) => s.label), ['Return created', 'Goods received', 'Credited'])
  assert.deepEqual(states(open), ['done', 'current', 'upcoming'])
  assert.equal(open.stages[0].date, at(8))
  assert.equal(open.nextHint, null)

  const received = returnFlowOf(returnOrder('6000000007', 'received'))
  assert.deepEqual(states(received), ['done', 'done', 'current'])
  assert.equal(received.stages[1].date, at(9))
  assert.equal(received.nextHint, null)

  const credited = returnFlowOf(returnOrder('6000000007', 'credited', { creditMemo: memo('9500000004', 96.34, 10) }))
  assert.deepEqual(states(credited), ['done', 'done', 'done'])
  assert.equal(credited.stages[2].date, at(10))
  assert.deepEqual(credited.stages[2].doc, { kind: 'creditMemo', number: '9500000004' })
  assert.equal(credited.nextHint, null)
})

test('every line closed with nothing shipped: no delivery can follow; Delivery stands, and no hint since Cancel is on this page', async () => {
  const { flowOf } = await load()
  const flow = flowOf(confirmed({
    lines: [{ item: 10, sku: 'P1', qty: 2, shippedQty: 0, closedQty: 2 }],
    can: { ...NO_MOVES, cancel: true }
  }))
  assert.equal(stage(flow, 'delivery').state, 'current')
  assert.equal(flow.nextHint, null)
})
