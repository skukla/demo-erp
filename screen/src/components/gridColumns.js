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
 *
 * The narrowest window they are set for is 1,280 px with the side menu open, which gives a
 * list LIST_WIDTH px and a table in a card (a document's lines, a customer's tables)
 * CARD_TABLE_WIDTH px. A grid's numbers and its shares' minimums add up to no more than
 * that (test/column-resizing.test.js), so no column sits past the edge, where the grid's
 * card hides it. A share holds text that wraps, so its minimum is its heading or its
 * longest word and it is what gives up width first; a wider window gives the shares the rest.
 * Measured 2026-10-04: the widths had been set at 1,440 px, and at 1,280 most lists and
 * several document tables scrolled sideways and cut their last heading.
 *
 * A button column ('action') comes FIRST in its row: a column past the edge is out of sight,
 * and a button there cannot be pressed. Spectrum's table cannot pin a column, so the button
 * goes where the edge never reaches; the column after it is the row's header.
 */

/** What a list gets at a 1,280 px window with the side menu: 1,280 less the 208 px menu,
    the page's 32 px each side and the grid's own edge. */
export const LIST_WIDTH = 1004
/** What a table inside a card gets at the same window: the card's 24 px each side less. */
export const CARD_TABLE_WIDTH = 956

export const GRID_COLUMNS = {
  orders: [
    { key: 'number', width: 150, holds: 'key' },
    // Each width that moved on 2026-10-03 was a heading cut by its chevrons, measured.
    { key: 'date', width: 124, holds: 'date' },
    { key: 'reference', width: '1fr', minWidth: 120, holds: 'text' },
    // A customer's name wraps; "Sold-to" and its chevrons need 102.
    { key: 'partner', width: '2fr', minWidth: 110, holds: 'text' },
    // The statuses' headings and badges, measured 2026-10-04, plus a few px.
    { key: 'shipping', width: 115, holds: 'status' },
    { key: 'billing', width: 108, holds: 'status' },
    { key: 'total', width: 125, holds: 'amount' },
    { key: 'status', width: 116, holds: 'status' }
  ],
  shipments: [
    { key: 'number', width: 150, holds: 'key' },
    { key: 'date', width: 146, holds: 'date' },
    { key: 'order', width: 150, holds: 'key' },
    { key: 'partner', width: '2fr', minWidth: 120, holds: 'text' },
    { key: 'warehouse', width: '1fr', minWidth: 120, holds: 'text' },
    { key: 'qty', width: 100, holds: 'quantity' },
    { key: 'status', width: 120, holds: 'status' }
  ],
  invoices: [
    { key: 'number', width: 140, holds: 'key' },
    { key: 'date', width: 140, holds: 'date' },
    { key: 'order', width: 150, holds: 'key' },
    { key: 'partner', width: '2fr', minWidth: 110, holds: 'text' },
    { key: 'total', width: 135, holds: 'amount' },
    { key: 'open', width: 140, holds: 'amount' },
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
    { key: 'number', width: 155, holds: 'key' },
    { key: 'date', width: 110, holds: 'date' },
    { key: 'order', width: 150, holds: 'key' },
    { key: 'invoice', width: 150, holds: 'key' },
    { key: 'return', width: 160, holds: 'key' },
    { key: 'partner', width: '2fr', minWidth: 110, holds: 'text' },
    { key: 'total', width: 135, holds: 'amount' }
  ],
  payments: [
    { key: 'number', width: 140, holds: 'key' },
    { key: 'date', width: 110, holds: 'date' },
    { key: 'invoice', width: 150, holds: 'key' },
    { key: 'order', width: 150, holds: 'key' },
    { key: 'partner', width: '2fr', minWidth: 110, holds: 'text' },
    // A card payment's reference (8FK21345TX901234A) is one word, and was cut at 150.
    { key: 'reference', width: '1fr', minWidth: 182, holds: 'text' },
    { key: 'amount', width: 130, holds: 'amount' }
  ],
  /* Eight columns fit a 1,440px window with the rail open; a ninth (Committed) clipped the
     grid, so Committed is on the product's page and the list shows On hand and Available. */
  products: [
    { key: 'sku', width: 135, holds: 'key' },
    // A product name wraps; "Description" and its chevrons need 130.
    { key: 'name', width: '2fr', minWidth: 130, holds: 'text' },
    /* "Configurable · 16 variants" is the longest thing this column holds, and it wraps after
       the "·" (it needed 198 px on one line and wrapped at 175 too). 135 holds "Configurable ·",
       and is what lets the eight columns fit the 1,164 px a 1,440 px window gives the list: at
       175 they scrolled 31 px sideways (measured 2026-10-03). */
    { key: 'kind', width: '1fr', minWidth: 135, holds: 'text' },
    /* Wider than the words need: the headings are set in uppercase with letter-spacing,
       which costs about a quarter again on a short one. "Base unit" was clipping. */
    { key: 'unit', width: 115, holds: 'text' },
    // 150, not less: at 130 the price's edit button ran 3 px past its cell (2026-10-04).
    { key: 'listPrice', width: 150, holds: 'amount' },
    { key: 'stock', width: 105, holds: 'quantity' },
    { key: 'available', width: 115, holds: 'quantity' },
    { key: 'status', width: 115, holds: 'status' }
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
  /* "Sales orgs", "Terms" and "Block", not "Sales organizations", "Payment terms" and "Credit
     block": the long headings alone needed 480 px, and the list 1,145 of the 1,004 a 1,280 px
     window gives it (owner approved the short ones, 2026-10-04). The amounts are their widest
     cell: the credit limit's edit button for USD 120,000.00 needs 164. A long block ("Stop
     invoicing") wraps. */
  partners: [
    { key: 'id', width: 136, holds: 'key' },
    // "Adventure", the longest word of a name here, needs 100.
    { key: 'name', width: '2fr', minWidth: 100, holds: 'text' },
    { key: 'salesOrgs', width: '1fr', minWidth: 124, holds: 'text' },
    { key: 'terms', width: 94, holds: 'text' },
    { key: 'creditLimit', width: 166, holds: 'amount' },
    { key: 'exposure', width: 125, holds: 'amount' },
    { key: 'available', width: 145, holds: 'amount' },
    { key: 'blocking', width: 112, holds: 'status' }
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
    { key: 'appliesTo', width: '1fr', minWidth: 120, holds: 'text' },
    { key: 'description', width: '1fr', minWidth: 150, holds: 'text' },
    { key: 'term', width: 230, holds: 'text' },
    { key: 'status', width: 190, holds: 'status' }
  ],
  openItems: [
    { key: 'number', width: 125, holds: 'key' },
    { key: 'date', width: 132, holds: 'date' },
    { key: 'due', width: 112, holds: 'date' },
    { key: 'order', width: '1fr', minWidth: 133, holds: 'key' },
    { key: 'total', width: 125, holds: 'amount' },
    { key: 'open', width: 130, holds: 'amount' },
    { key: 'status', width: 157, holds: 'status' }
  ],
  contracts: [
    { key: 'number', width: 165, holds: 'key' },
    { key: 'appliesTo', width: '2fr', minWidth: 120, holds: 'text' },
    { key: 'description', width: '2fr', minWidth: 132, holds: 'text' },
    { key: 'term', width: 230, holds: 'text' },
    { key: 'lines', width: 90, holds: 'quantity' },
    { key: 'status', width: 190, holds: 'status' }
  ],
  contractLines: [
    // The quiet Remove button is 78 px and was cut at 100, as on Price Groups (2026-10-04).
    { key: 'remove', width: 122, holds: 'action' },
    { key: 'sku', width: '1fr', minWidth: 150, holds: 'key' },
    { key: 'kind', width: 150, holds: 'text' },
    { key: 'amount', width: 130, holds: 'amount' },
    { key: 'minQty', width: 150, holds: 'quantity' },
    { key: 'dates', width: 230, holds: 'text' }
  ],
  priceGroups: [
    // The quiet Remove button was cut at 100 (measured 2026-10-03).
    { key: 'remove', width: 122, holds: 'action' },
    { key: 'code', width: 200, holds: 'key' },
    { key: 'name', width: '1fr', minWidth: 200, holds: 'text' },
    { key: 'customers', width: 130, holds: 'quantity' }
  ],
  /* A 1,440px window gives the list 1,164 px. With the resize chevron, "Sales org" was cut
     by 20 px, "Min. qty" by 3, an agreed price by 3 and the Remove button by 31 (measured
     2026-10-03), so those four grew by 93 px: 53 of the 59 the shares had above their
     minimums, and 40 from Rule, Product and Valid (Customer's minimum rose 10 to hold
     "Northwind Trading" on one line). Each of those was wrapping onto two lines already, and
     each still breaks where it did: Rule's minimum holds "discount · CD01", Customer's
     "Northwind Trading", Product's "All products", Valid's 150 "Sep 1, 2026 →". The columns'
     minimums added up to 1,158 px, which fit 1,440 and not 1,280 (2026-10-04): Rule, Customer,
     Product and Valid are shares now, down to their headings or their longest word, and the
     minimums add up to 999. Valid wraps after the arrow at the narrowest. */
  pricing: [
    // The quiet Remove button, as on Price Groups: first, where the edge never reaches.
    { key: 'remove', width: 122, holds: 'action' },
    { key: 'rule', width: '1fr', minWidth: 100, holds: 'text' },
    { key: 'customer', width: '1fr', minWidth: 117, holds: 'text' },
    { key: 'product', width: '1fr', minWidth: 108, holds: 'text' },
    // Its heading and chevron need 115.5; a drag narrower would cut it again.
    { key: 'scope', width: 118, minWidth: 118, holds: 'key' },
    // An agreed price of four figures, "USD 1,250.00", on one line.
    { key: 'amount', width: 134, holds: 'amount' },
    { key: 'minQty', width: 94, minWidth: 94, holds: 'quantity' },
    { key: 'validity', width: '1fr', minWidth: 96, holds: 'text' },
    { key: 'status', width: 110, holds: 'status' }
  ],
  events: [
    { key: 'at', width: 200, holds: 'date' },
    { key: 'direction', width: 180, holds: 'text' },
    { key: 'event', width: '1fr', minWidth: 200, holds: 'text' },
    // "failed after 10 tries" is the longest of these, and wrapping doubles the row.
    { key: 'state', width: 190, holds: 'status' },
    { key: 'detail', width: '1fr', minWidth: 150, holds: 'text' }
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
     holds its heading; Close's 100 its button, "Close" since 2026-10-04 (at 156 "Close remaining" was cut). */
  orderLines: [
    { key: 'item', label: 'Item', width: 62, holds: 'line' },
    { key: 'sku', label: 'Product', width: 110, holds: 'key' },
    { key: 'name', label: 'Description', width: '1fr', minWidth: 130, holds: 'text' },
    { key: 'qty', label: 'Qty', width: 64, minWidth: 64, align: 'end', holds: 'quantity' },
    { key: 'shipped', label: 'Shipped', width: 92, minWidth: 92, align: 'end', holds: 'quantity' },
    { key: 'open', label: 'Open', width: 75, minWidth: 75, align: 'end', holds: 'quantity' },
    { key: 'unit', label: 'Unit', width: 79, minWidth: 79, holds: 'text' },
    // "Price" and "Amount", not "Net price" and "Net amount" (owner, 2026-10-04): their widest cell.
    { key: 'price', label: 'Price', width: 116, align: 'end', holds: 'amount' },
    { key: 'amount', label: 'Amount', width: 120, align: 'end', holds: 'amount' }
  ],
  /* At 1,280 px the invoice's lines needed 1,000 px of the card's 956, and a credit memo's
     with Discount 1,003: the "Net amount" heading was cut (2026-10-04). Each narrow column is
     now its heading, or its widest cell, plus a few px, as on the order's lines. */
  invoiceLines: [
    { key: 'item', label: 'Item', width: 64, holds: 'line' },
    { key: 'sku', label: 'Product', width: 120, holds: 'key' },
    { key: 'name', label: 'Description', width: '1fr', minWidth: 130, holds: 'text' },
    { key: 'qty', label: 'Qty', width: 72, align: 'end', holds: 'quantity' },
    { key: 'unit', label: 'Base unit', width: 116, holds: 'text' },
    { key: 'price', label: 'Net price', width: 125, align: 'end', holds: 'amount' },
    { key: 'amount', label: 'Net amount', width: 135, align: 'end', holds: 'amount' }
  ],
  creditMemoLines: [
    { key: 'item', label: 'Item', width: 64, holds: 'line' },
    { key: 'sku', label: 'Product', width: 120, holds: 'key' },
    { key: 'name', label: 'Description', width: '1fr', minWidth: 130, holds: 'text' },
    { key: 'qty', label: 'Qty', width: 72, align: 'end', holds: 'quantity' },
    { key: 'price', label: 'Net price', width: 125, align: 'end', holds: 'amount' },
    { key: 'amount', label: 'Net amount', width: 135, align: 'end', holds: 'amount' }
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
    { key: 'edit', width: 96, holds: 'action' },
    { key: 'code', width: 90, holds: 'key' },
    { key: 'name', width: '1fr', minWidth: 115, holds: 'text' },
    { key: 'currency', width: 114, holds: 'key' },
    { key: 'website', width: 101, holds: 'key' }
  ],
  returnReasons: [
    { key: 'code', width: 160, holds: 'key' },
    { key: 'description', width: '1fr', holds: 'text' }
  ]
}

/** Close remaining, on a sales order line that can still be closed: a button, one size, and
    the first column, as every button column is. */
export const ORDER_LINE_CLOSE = { key: 'close', label: ' ', width: 100, align: 'end', holds: 'action' }
