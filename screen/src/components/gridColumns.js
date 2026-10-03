/*
 * Every grid's columns, in one place, so one test can read them all
 * (test/column-resizing.test.js). Each column says what it HOLDS, and that decides
 * whether it can be dragged wider or narrower (./columnWidths.js):
 *
 * - text, an identifier ('key'), a date, an amount, a quantity, a status: RESIZABLE. A
 *   name, a reference or an amount in another currency can be longer than the measured
 *   default, and a grid someone reads all day is one they arrange to suit them;
 * - a line number ('line': 10, 20, 30), a button ('action'), an input ('input'), a number of
 *   fixed length ('serial': a number series' ten-digit bounds): FIXED. Their content is one
 *   size, so a drag would only move empty space — and on a button column with no heading,
 *   the drag handle is a chevron hanging under a blank title;
 * - the last column, when it is a share: its right edge is the table's edge, so it takes
 *   what the others leave and widens or narrows when any column left of it is dragged.
 *
 * A number is the column's starting width, measured to fit its heading and widest cell; a
 * fraction ('1fr', '2fr') makes it a share of what the numbers leave, and every grid has at
 * least one, so it fills its area. A resizable heading carries Spectrum's menu chevron and a
 * sortable one its sort arrow, each about 20 px: the widths below have room for both.
 */

export const GRID_COLUMNS = {
  orders: [
    { key: 'number', width: 150, holds: 'key' },
    // Each width that moved on 2026-10-03 was a heading cut by its chevrons, measured.
    { key: 'date', width: 124, holds: 'date' },
    { key: 'reference', width: '1fr', minWidth: 130, holds: 'text' },
    { key: 'partner', width: '2fr', minWidth: 210, holds: 'text' },
    { key: 'shipping', width: 135, holds: 'status' },
    { key: 'billing', width: 125, holds: 'status' },
    { key: 'total', width: 125, holds: 'amount' },
    { key: 'status', width: 130, holds: 'status' }
  ],
  shipments: [
    { key: 'number', width: 150, holds: 'key' },
    { key: 'date', width: 146, holds: 'date' },
    { key: 'order', width: 150, holds: 'key' },
    { key: 'partner', width: '2fr', minWidth: 200, holds: 'text' },
    { key: 'warehouse', width: '1fr', minWidth: 160, holds: 'text' },
    { key: 'qty', width: 100, holds: 'quantity' },
    { key: 'status', width: 120, holds: 'status' }
  ],
  invoices: [
    { key: 'number', width: 165, holds: 'key' },
    { key: 'date', width: 140, holds: 'date' },
    { key: 'order', width: 150, holds: 'key' },
    { key: 'partner', width: '2fr', minWidth: 220, holds: 'text' },
    { key: 'total', width: 150, holds: 'amount' },
    { key: 'open', width: 150, holds: 'amount' },
    { key: 'status', width: 157, holds: 'status' }
  ],
  returns: [
    { key: 'number', width: 160, holds: 'key' },
    { key: 'date', width: 130, holds: 'date' },
    { key: 'order', width: 150, holds: 'key' },
    { key: 'partner', width: '2fr', minWidth: 200, holds: 'text' },
    { key: 'lines', width: 100, holds: 'quantity' },
    { key: 'status', width: 130, holds: 'status' }
  ],
  creditMemos: [
    { key: 'number', width: 165, holds: 'key' },
    { key: 'date', width: 130, holds: 'date' },
    { key: 'order', width: 150, holds: 'key' },
    { key: 'invoice', width: 150, holds: 'key' },
    { key: 'return', width: 160, holds: 'key' },
    { key: 'partner', width: '2fr', minWidth: 200, holds: 'text' },
    { key: 'total', width: 150, holds: 'amount' }
  ],
  payments: [
    { key: 'number', width: 165, holds: 'key' },
    { key: 'date', width: 130, holds: 'date' },
    { key: 'invoice', width: 150, holds: 'key' },
    { key: 'order', width: 150, holds: 'key' },
    { key: 'partner', width: '2fr', minWidth: 200, holds: 'text' },
    // A card payment's reference (8FK21345TX901234A) is one word, and was cut at 150.
    { key: 'reference', width: '1fr', minWidth: 182, holds: 'text' },
    { key: 'amount', width: 150, holds: 'amount' }
  ],
  /* Eight columns fit a 1,440px window with the rail open; a ninth (Committed) clipped the
     grid, so Committed is on the product's page and the list shows On hand and Available. */
  products: [
    { key: 'sku', width: 150, holds: 'key' },
    // Room for a product name to read whole, even as an edit button.
    { key: 'name', width: '2fr', minWidth: 220, holds: 'text' },
    // "Configurable · 16 variants" is the longest thing this column holds.
    { key: 'kind', width: '1fr', minWidth: 175, holds: 'text' },
    /* Wider than the words need: the headings are set in uppercase with letter-spacing,
       which costs about a quarter again on a short one. "Base unit" was clipping. */
    { key: 'unit', width: 115, holds: 'text' },
    { key: 'listPrice', width: 150, holds: 'amount' },
    { key: 'stock', width: 105, holds: 'quantity' },
    { key: 'available', width: 115, holds: 'quantity' },
    { key: 'status', width: 165, holds: 'status' }
  ],
  variants: [
    { key: 'values', width: '1fr', minWidth: 120, holds: 'text' },
    { key: 'sku', width: 220, holds: 'key' },
    { key: 'price', width: 130, holds: 'amount' },
    { key: 'stock', width: 104, holds: 'quantity' },
    { key: 'status', width: 150, holds: 'status' }
  ],
  // A product's stock by warehouse (its id predates the Warehouses list's).
  warehouses: [
    { key: 'name', width: '1fr', minWidth: 140, holds: 'text' },
    { key: 'code', width: 180, holds: 'key' },
    { key: 'quantity', width: 180, holds: 'quantity' },
    { key: 'status', width: 160, holds: 'status' }
  ],
  /* Three columns: the card is half the page wide, and the order's status is one click
     away on the order itself. */
  'product-open-orders': [
    { key: 'number', width: 140, holds: 'key' },
    { key: 'customer', width: '1fr', minWidth: 140, holds: 'text' },
    { key: 'qty', width: 100, holds: 'quantity' }
  ],
  warehouseList: [
    { key: 'code', width: 220, holds: 'key' },
    { key: 'name', width: '1fr', minWidth: 220, holds: 'text' },
    { key: 'products', width: 130, holds: 'quantity' },
    { key: 'stock', width: 130, holds: 'quantity' }
  ],
  partners: [
    { key: 'id', width: 136, holds: 'key' },
    { key: 'name', width: '2fr', minWidth: 96, holds: 'text' },
    // Its heading and both chevrons need 192 (2026-10-03); Exposure and Available gave 5 each.
    { key: 'salesOrgs', width: '1fr', minWidth: 192, holds: 'text' },
    { key: 'terms', width: 154, holds: 'text' },
    { key: 'creditLimit', width: 172, holds: 'amount' },
    { key: 'exposure', width: 125, holds: 'amount' },
    { key: 'available', width: 145, holds: 'amount' },
    { key: 'blocking', width: 140, holds: 'status' }
  ],
  customerOrders: [
    { key: 'number', width: 165, holds: 'key' },
    { key: 'date', width: 140, holds: 'date' },
    { key: 'reference', width: '1fr', minWidth: 150, holds: 'text' },
    { key: 'net', width: 150, holds: 'amount' },
    { key: 'status', width: 140, holds: 'status' }
  ],
  customerPricing: [
    { key: 'rule', width: '1fr', minWidth: 230, holds: 'text' },
    { key: 'product', width: '1fr', minWidth: 190, holds: 'text' },
    { key: 'amount', width: 150, holds: 'amount' }
  ],
  customerPriceLists: [
    { key: 'number', width: 165, holds: 'key' },
    { key: 'appliesTo', width: 240, holds: 'text' },
    { key: 'description', width: '1fr', minWidth: 150, holds: 'text' },
    { key: 'term', width: 230, holds: 'text' },
    { key: 'status', width: 190, holds: 'status' }
  ],
  openItems: [
    { key: 'number', width: 165, holds: 'key' },
    { key: 'date', width: 140, holds: 'date' },
    { key: 'due', width: 140, holds: 'date' },
    { key: 'order', width: '1fr', minWidth: 150, holds: 'key' },
    { key: 'total', width: 150, holds: 'amount' },
    { key: 'open', width: 150, holds: 'amount' },
    { key: 'status', width: 157, holds: 'status' }
  ],
  contracts: [
    { key: 'number', width: 165, holds: 'key' },
    { key: 'appliesTo', width: '2fr', minWidth: 240, holds: 'text' },
    { key: 'description', width: '2fr', minWidth: 180, holds: 'text' },
    { key: 'term', width: 230, holds: 'text' },
    { key: 'lines', width: 90, holds: 'quantity' },
    { key: 'status', width: 190, holds: 'status' }
  ],
  contractLines: [
    { key: 'sku', width: '1fr', minWidth: 150, holds: 'key' },
    { key: 'kind', width: 150, holds: 'text' },
    { key: 'amount', width: 130, holds: 'amount' },
    { key: 'minQty', width: 150, holds: 'quantity' },
    { key: 'dates', width: 230, holds: 'text' },
    { key: 'remove', width: 100, holds: 'action' }
  ],
  priceGroups: [
    { key: 'code', width: 200, holds: 'key' },
    { key: 'name', width: '1fr', minWidth: 200, holds: 'text' },
    { key: 'customers', width: 130, holds: 'quantity' },
    // The quiet Remove button was cut at 100 (measured 2026-10-03).
    { key: 'remove', width: 122, holds: 'action' }
  ],
  /* Fixed columns add up to 590px and the three flexible ones need 480px more, so the
     grid fits the 1,170px content area at a 1,440px window without a horizontal scroll
     (the Remove column was clipped at 1,220px, measured 2026-09-24). */
  pricing: [
    { key: 'rule', width: '1fr', minWidth: 170, holds: 'text' },
    { key: 'customer', width: '1fr', minWidth: 150, holds: 'text' },
    { key: 'product', width: '1fr', minWidth: 130, holds: 'text' },
    { key: 'scope', width: 95, holds: 'key' },
    { key: 'amount', width: 100, holds: 'amount' },
    { key: 'minQty', width: 90, holds: 'quantity' },
    { key: 'validity', width: 170, holds: 'text' },
    { key: 'status', width: 110, holds: 'status' },
    { key: 'remove', width: 90, holds: 'action' }
  ],
  events: [
    { key: 'at', width: 200, holds: 'date' },
    { key: 'direction', width: 180, holds: 'text' },
    { key: 'event', width: '1fr', minWidth: 270, holds: 'text' },
    // "failed after 10 tries" is the longest of these, and wrapping doubles the row.
    { key: 'state', width: 190, holds: 'status' },
    { key: 'detail', width: '1fr', minWidth: 200, holds: 'text' }
  ],
  /* Item, Product, Open, Ship now: the dialog's own table. Ship now is a number field, the
     same size whatever is typed in it. */
  linesToShip: [
    { key: 'item', width: 70, holds: 'line' },
    { key: 'name', width: '1fr', holds: 'text' },
    { key: 'open', width: 90, holds: 'quantity' },
    { key: 'ship', width: 170, holds: 'input' }
  ],
  /* A sales order's lines. They add up to what a 1,440px window gives the table (1,116 px)
     with BOTH the Discount and the Close column, which scrolled sideways by 86 px once their
     headings carried the resize chevron: Qty and Unit are the short headings the owner
     approved (2026-10-03), and each narrow column is its heading or its widest cell plus a
     few px, measured — so its minimum is its width, or the heading would be cut. Item's 62
     holds its heading; Close's 164 its button (at 156 the button was cut). */
  orderLines: [
    { key: 'item', label: 'Item', width: 62, holds: 'line' },
    { key: 'sku', label: 'Product', width: 110, holds: 'key' },
    { key: 'name', label: 'Description', width: '1fr', minWidth: 130, holds: 'text' },
    { key: 'qty', label: 'Qty', width: 64, minWidth: 64, align: 'end', holds: 'quantity' },
    { key: 'shipped', label: 'Shipped', width: 92, minWidth: 92, align: 'end', holds: 'quantity' },
    { key: 'open', label: 'Open', width: 75, minWidth: 75, align: 'end', holds: 'quantity' },
    { key: 'unit', label: 'Unit', width: 79, minWidth: 79, holds: 'text' },
    { key: 'price', label: 'Net price', width: 112, align: 'end', holds: 'amount' },
    { key: 'amount', label: 'Net amount', width: 122, align: 'end', holds: 'amount' }
  ],
  // With Discount the invoice's lines scrolled 7 px sideways at 170 for Product (measured).
  invoiceLines: [
    { key: 'item', label: 'Item', width: 90, holds: 'line' },
    { key: 'sku', label: 'Product', width: 150, holds: 'key' },
    { key: 'name', label: 'Description', width: '1fr', minWidth: 220, holds: 'text' },
    { key: 'qty', label: 'Qty', width: 110, align: 'end', holds: 'quantity' },
    { key: 'unit', label: 'Base unit', width: 120, holds: 'text' },
    { key: 'price', label: 'Net price', width: 150, align: 'end', holds: 'amount' },
    { key: 'amount', label: 'Net amount', width: 160, align: 'end', holds: 'amount' }
  ],
  creditMemoLines: [
    { key: 'item', label: 'Item', width: 90, holds: 'line' },
    { key: 'sku', label: 'Product', width: 170, holds: 'key' },
    { key: 'name', label: 'Description', width: '1fr', minWidth: 220, holds: 'text' },
    { key: 'qty', label: 'Qty', width: 110, align: 'end', holds: 'quantity' },
    { key: 'price', label: 'Net price', width: 150, align: 'end', holds: 'amount' },
    { key: 'amount', label: 'Net amount', width: 160, align: 'end', holds: 'amount' }
  ],
  shipmentLines: [
    { key: 'item', width: 90, holds: 'line' },
    { key: 'sku', width: 170, holds: 'key' },
    { key: 'name', width: '1fr', minWidth: 220, holds: 'text' },
    { key: 'qty', width: 140, holds: 'quantity' },
    // "Base unit" and the resize chevron need 112 (2026-10-03).
    { key: 'unit', width: 120, holds: 'text' }
  ],
  returnLines: [
    { key: 'item', width: 90, holds: 'line' },
    { key: 'sku', width: 170, holds: 'key' },
    { key: 'name', width: '1fr', minWidth: 200, holds: 'text' },
    { key: 'qty', width: 135, holds: 'quantity' },
    { key: 'unit', width: 120, holds: 'text' },
    { key: 'reason', width: '1fr', minWidth: 160, holds: 'text' }
  ],
  numberSeries: [
    { key: 'type', width: '1fr', minWidth: 110, holds: 'text' },
    /* Starting and Ending are a series' bounds: ten digits, always, so one width whatever
       they say. Resizable, their headings carry a chevron and need 134 each, and the card's
       520 px then cuts the Document heading (measured 2026-10-03). */
    { key: 'starting', width: 120, holds: 'serial' },
    /* 160, not 140 (AB-65): the cell is its width less 32 px of Spectrum's own padding, and
       a ten-digit number in its edit button is up to 113 px. At 140 the button was cut off,
       and a table cell marks a cut with "…" — whose first dot showed after the narrowest
       number (0000001010). The Document column gives up the 20 px. */
    { key: 'next', width: 160, holds: 'key' },
    { key: 'ending', width: 120, holds: 'serial' }
  ],
  /* The card's table is 520 px at 1,440 px. Edit 96, not 80 (AB-65): the quiet button and its
     margin are 14 px wider than an 80 px cell less Spectrum's 32 px of padding, so the cell
     held a cut. Currency and Website are their headings and the resize chevron; Name's
     minimum is 115, its heading's: a long name wraps. */
  salesOrganizations: [
    { key: 'code', width: 90, holds: 'key' },
    { key: 'name', width: '1fr', minWidth: 115, holds: 'text' },
    { key: 'currency', width: 114, holds: 'key' },
    { key: 'website', width: 101, holds: 'key' },
    { key: 'edit', width: 96, holds: 'action' }
  ],
  returnReasons: [
    { key: 'code', width: 160, holds: 'key' },
    { key: 'description', width: '1fr', holds: 'text' }
  ]
}

/** Close remaining, on a sales order line that can still be closed: a button, one size. */
export const ORDER_LINE_CLOSE = { key: 'close', label: ' ', width: 164, align: 'end', holds: 'action' }
