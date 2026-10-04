/*
 * Every column someone may want wider or narrower can be dragged (owner, 2026-10-03: "some
 * columns in some grids in the ERP are not resizable").
 *
 * The rule, as screen/src/components/gridColumns.js states it: a column holding text, an
 * identifier, a date, an amount, a quantity or a status can be resized. Only a column whose
 * content is a fixed size stays put — a line number (10, 20), a button, an input, a number
 * of fixed length (a number series' ten-digit bounds) — and the
 * last column when it is a share, because its right edge IS the table's edge: it takes what
 * the others leave, and dragging any column left of it resizes it.
 *
 * Two halves. A static one: every <Column> on the screen takes its props from
 * useColumnWidths, so no grid can set a width that bypasses the rule. And the rule itself,
 * run over every grid's declared columns.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const COMPONENTS = path.join(__dirname, '..', 'screen', 'src', 'components')
const loadWidths = () => import('../screen/src/components/columnWidths.js')
const loadGrids = () => import('../screen/src/components/gridColumns.js')
const loadDiscount = () => import('../screen/src/components/lineDiscount.js')

/* What a column may hold, and which of those may stay a fixed width. */
const FIXED_KINDS = new Set(['line', 'action', 'input', 'serial'])
const KINDS = new Set([...FIXED_KINDS, 'key', 'text', 'date', 'amount', 'quantity', 'status'])

test('every <Column> on the screen takes its width and resizing from useColumnWidths', () => {
  const bypassing = []
  let seen = 0
  for (const file of fs.readdirSync(COMPONENTS).filter((f) => f.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(COMPONENTS, file), 'utf8')
    for (const tag of source.match(/<Column\b[^>]*>/g) || []) {
      seen += 1
      // Its width and resizing come from the hook, and nothing after the spread overrides them.
      const fromHook = /\{\.\.\.\w+\.columnProps\(/.test(tag)
      const overridden = /\b(allowsResizing|width|minWidth|maxWidth|defaultWidth)=/.test(tag)
      if (!fromHook || overridden) bypassing.push(`${file}: ${tag}`)
    }
  }
  assert.ok(seen > 100, `the scan found the grids (${seen} columns)`)
  assert.deepEqual(bypassing, [])
})

test('every column says what it holds, and every one that is not fixed-size can be resized', async () => {
  const { resizes } = await loadWidths()
  const { GRID_COLUMNS, ORDER_LINE_CLOSE } = await loadGrids()
  const { DISCOUNT_COLUMN } = await loadDiscount()
  const grids = {
    ...GRID_COLUMNS,
    // The two columns a document's lines gain only sometimes, in place.
    'orderLines+discount+close': [ORDER_LINE_CLOSE, ...GRID_COLUMNS.orderLines.slice(0, -1), DISCOUNT_COLUMN, GRID_COLUMNS.orderLines.at(-1)]
  }
  const wrong = []
  let columns = 0
  for (const [grid, set] of Object.entries(grids)) {
    for (const column of set) {
      columns += 1
      if (!KINDS.has(column.holds)) wrong.push(`${grid}.${column.key} holds "${column.holds}"`)
      const last = column === set.at(-1)
      const edge = last && typeof column.width === 'string'
      if (!FIXED_KINDS.has(column.holds) && !edge && !resizes(column, set)) wrong.push(`${grid}.${column.key} (${column.holds}) cannot be resized`)
    }
  }
  assert.ok(columns > 100, `every grid was read (${columns} columns)`)
  assert.deepEqual(wrong, [])
})

/* The columns that do not resize, each for the reason gridColumns.js gives. A column moved
   into this list has to be moved here too, on purpose: relabelling a text column as a button
   would otherwise switch its resizing off without a test noticing. */
const NOT_RESIZABLE = [
  'pricing.remove', 'events.detail', 'linesToShip.item', 'linesToShip.ship',
  'contractLines.remove', 'priceGroups.remove',
  'orderLines.item', 'invoiceLines.item', 'creditMemoLines.item', 'shipmentLines.item',
  'returnLines.item', 'returnLines.reason', 'numberSeries.starting', 'numberSeries.ending',
  'salesOrganizations.edit', 'returnReasons.description', 'orderLines.close'
]

test('exactly the audited columns stay fixed: line numbers, buttons, an input, series bounds, a share at the edge', async () => {
  const { resizes } = await loadWidths()
  const { GRID_COLUMNS, ORDER_LINE_CLOSE } = await loadGrids()
  const fixed = Object.entries({ ...GRID_COLUMNS, orderLines: [ORDER_LINE_CLOSE, ...GRID_COLUMNS.orderLines] })
    .flatMap(([grid, set]) => set.filter((c) => !resizes(c, set)).map((c) => `${grid}.${c.key}`))
  assert.deepEqual(fixed.sort(), [...NOT_RESIZABLE].sort())
})

test('a grid always has a share column, so it fills its area whatever is dragged', async () => {
  const { GRID_COLUMNS } = await loadGrids()
  const without = Object.entries(GRID_COLUMNS).filter(([, set]) => !set.some((c) => typeof c.width === 'string')).map(([grid]) => grid)
  assert.deepEqual(without, [])
})

/* The narrowest a grid can be: its numbers, which hold, and its shares' minimums. */
const narrowest = (set) => set.reduce((sum, c) => sum + (typeof c.width === 'number' ? c.width : (c.minWidth || 0)), 0)

/* Where each grid is drawn: a list across the page, or a table inside a card (a document's
   lines, a customer's or a product's tables, a Settings card once Settings is one column). */
const LISTS = ['orders', 'shipments', 'invoices', 'returns', 'creditMemos', 'payments', 'products', 'contracts', 'priceGroups', 'pricing', 'events', 'warehouseList']
const IN_CARDS = [
  'variants', 'warehouses', 'customerOrders', 'customerPricing', 'customerPriceLists', 'openItems',
  'contractLines', 'orderLines', 'invoiceLines', 'creditMemoLines', 'shipmentLines', 'returnLines',
  'numberSeries', 'salesOrganizations', 'returnReasons'
]
/* What still does not fit a 1,280 px window with the side menu, and why. A sales order's lines
   with BOTH a discount and a line still to close need 1,054 px: every column is its heading or
   its widest cell, after the short "Close", "Price" and "Amount" (2026-10-04). Fitting them takes
   a column fewer, which is the owner's call. A grid leaving this list is a fix, and the list
   must shrink with it. */
const TOO_WIDE = {
  'orderLines+discount+close': 'CARD'
}

test('every grid fits a 1,280 px window with the side menu: its numbers and its shares\' minimums add up to no more than its table', async () => {
  const { GRID_COLUMNS, ORDER_LINE_CLOSE, LIST_WIDTH, CARD_TABLE_WIDTH } = await loadGrids()
  const { withDiscountColumn } = await loadDiscount()
  const discounted = [{ discount: 1 }]
  const room = { LIST: LIST_WIDTH, CARD: CARD_TABLE_WIDTH }
  const grids = [
    ...LISTS.map((grid) => [grid, GRID_COLUMNS[grid], 'LIST']),
    ...IN_CARDS.map((grid) => [grid, GRID_COLUMNS[grid], 'CARD']),
    // A document's lines with the columns they gain only sometimes.
    ...['orderLines', 'invoiceLines', 'creditMemoLines'].map((grid) => [`${grid}+discount`, withDiscountColumn(GRID_COLUMNS[grid], discounted), 'CARD']),
    ['partners', GRID_COLUMNS.partners, 'LIST'],
    ['orderLines+close', [ORDER_LINE_CLOSE, ...GRID_COLUMNS.orderLines], 'CARD'],
    ['orderLines+discount+close', [ORDER_LINE_CLOSE, ...withDiscountColumn(GRID_COLUMNS.orderLines, discounted)], 'CARD']
  ]
  const tooWide = Object.fromEntries(grids
    .filter(([, set, where]) => narrowest(set) > room[where])
    .map(([grid, set, where]) => [grid, `${where}: ${narrowest(set)} > ${room[where]}`]))
  assert.deepEqual(Object.keys(tooWide).sort(), Object.keys(TOO_WIDE).sort(), JSON.stringify(tooWide))
  // Every grid on the screen was placed in one list or the other (linesToShip is a dialog's,
  // product-open-orders a half-page card's; both are far below either width).
  const placed = new Set([...LISTS, ...IN_CARDS, 'partners', 'linesToShip', 'product-open-orders'])
  assert.deepEqual(Object.keys(GRID_COLUMNS).filter((grid) => !placed.has(grid)), [])
})

test('a button column is the first in its row, so a grid too wide for the window never hides it', async () => {
  const { GRID_COLUMNS, ORDER_LINE_CLOSE } = await loadGrids()
  const misplaced = Object.entries(GRID_COLUMNS)
    .flatMap(([grid, set]) => set.filter((c, at) => c.holds === 'action' && at !== 0).map((c) => `${grid}.${c.key}`))
  assert.deepEqual(misplaced, [])
  const buttons = Object.values(GRID_COLUMNS).flat().filter((c) => c.holds === 'action').length
  assert.equal(buttons, 4, 'Pricing, Price Groups, a price list\'s lines and Sales Organizations each have one')
  assert.equal(ORDER_LINE_CLOSE.holds, 'action')
  // OrderLines.js puts Close remaining before the lines' own columns.
  const source = fs.readFileSync(path.join(COMPONENTS, 'OrderLines.js'), 'utf8')
  assert.match(source, /\[ORDER_LINE_CLOSE, \.\.\.priced\]/)
})

/* The drag itself (useColumnWidths' onResize, without React). */
const COLUMNS = [
  { key: 'number', width: 150, holds: 'key' },
  { key: 'name', width: '1fr', minWidth: 120, holds: 'text' },
  { key: 'amount', width: 130, holds: 'amount' },
  { key: 'status', width: 120, holds: 'status' }
]
const sizesOf = (columns) => Object.fromEntries(columns.map((c) => [c.key, c.width]))

test('dragging the only share column wider takes the width from the columns right of it, nearest first, each down to its minimum', async () => {
  const { resized } = await loadWidths()
  const start = sizesOf(COLUMNS)
  // name was 400 px; dragged to 480. amount gives 50 (to its minimum 80), status the other 30.
  const widths = new Map([['number', 150], ['name', 480], ['amount', 130], ['status', 120]])
  const next = resized(COLUMNS, { key: 'name', sizes: start, from: start, fromWidths: new Map([['name', 400]]), tableWidth: 800 }, widths)
  assert.deepEqual(next, { number: 150, name: '1fr', amount: 80, status: 90 })
})

test('dragging the only share column narrower gives the width to the column right of it, and it stays a share', async () => {
  const { resized } = await loadWidths()
  const start = sizesOf(COLUMNS)
  const widths = new Map([['number', 150], ['name', 360], ['amount', 130], ['status', 120]])
  const next = resized(COLUMNS, { key: 'name', sizes: start, from: start, fromWidths: new Map([['name', 400]]), tableWidth: 800 }, widths)
  assert.deepEqual(next, { number: 150, name: '1fr', amount: 170, status: 120 })
})

test('with two share columns, the dragged one keeps the width it was dragged to and the other fills', async () => {
  const { resized } = await loadWidths()
  const columns = [...COLUMNS.slice(0, 2), { key: 'reference', width: '1fr', minWidth: 100, holds: 'text' }, ...COLUMNS.slice(2)]
  const start = sizesOf(columns)
  const widths = new Map([['number', 150], ['name', 250], ['reference', '1fr'], ['amount', 130], ['status', 120]])
  const next = resized(columns, { key: 'name', sizes: start, from: start, fromWidths: new Map([['name', 200]]), tableWidth: 800 }, widths)
  assert.deepEqual(next, { number: 150, name: 250, reference: '1fr', amount: 130, status: 120 })
})

test('a fixed column right of every share grows into the share, down to its minimum, never past the table', async () => {
  // Spectrum hands over the share at its current 400 px, frozen. Counting it at that width
  // left Net amount on Sales orders no room to grow at all: every column right of the shares
  // could be narrowed and never widened.
  const { resized } = await loadWidths()
  const start = sizesOf(COLUMNS)
  // 800 less the share's minimum 120 and number's 150 and status's 120 leaves amount 410.
  const widths = new Map([['number', 150], ['name', 400], ['amount', 410], ['status', 120]])
  const next = resized(COLUMNS, { key: 'amount', sizes: start, from: start, fromWidths: new Map([['amount', 130]]), tableWidth: 800 }, widths)
  assert.deepEqual(next, { number: 150, name: '1fr', amount: 410, status: 120 })
})

test('past what the shares can give, a column takes from the columns right of it, each down to its minimum, and stops at the table\'s edge', async () => {
  // Sales orders at 1,440 px: its shares sit at their minimums, so nothing could grow (2026-10-03).
  const { resized } = await loadWidths()
  const start = sizesOf(COLUMNS)
  const widths = new Map([['number', 150], ['name', 400], ['amount', 900], ['status', 120]])
  const next = resized(COLUMNS, { key: 'amount', sizes: start, from: start, fromWidths: new Map([['amount', 130]]), tableWidth: 800 }, widths)
  // 280 from the share, 40 from status (120 down to its minimum 80): 450, and no further.
  assert.deepEqual(next, { number: 150, name: '1fr', amount: 450, status: 80 })
})

test('the dragged column is the one that moved in the drag\'s first step, even when it is the frozen share\'s neighbour', async () => {
  const { draggedKey } = await loadWidths()
  // Spectrum: the share left of the dragged column frozen at 400 px, the rest as declared.
  const from = new Map([['number', 150], ['name', 400], ['amount', 130], ['status', 120]])
  assert.equal(draggedKey(COLUMNS, from, new Map([...from, ['amount', 140]])), 'amount')
  // A column at its minimum dragged narrower moves nothing yet.
  assert.equal(draggedKey(COLUMNS, from, new Map(from)), null)
})

test('a button column and a share at the table\'s edge do not resize; everything else does', async () => {
  const { resizes } = await loadWidths()
  const columns = [...COLUMNS, { key: 'detail', width: '1fr', holds: 'text' }]
  assert.equal(resizes({ key: 'remove', width: 90, holds: 'action' }, columns), false)
  assert.equal(resizes({ key: 'item', width: 75, holds: 'line' }, columns), false)
  assert.equal(resizes(columns.at(-1), columns), false)
  assert.equal(resizes(columns[1], columns), true)
  assert.equal(resizes(columns[0], columns), true)
})
