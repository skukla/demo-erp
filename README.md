# demo-erp

A mock ERP, modeled on SAP, that runs as an Adobe App Builder app. It is a Demo Builder
**system** component: it ships with the Commerce ERP integration
([skukla/commerce-erp-integration](https://github.com/skukla/commerce-erp-integration)),
is installed and removed with it, and knows nothing about Commerce itself.

What it holds, in SAP's words:

| Collection | What it is | Who owns the values |
|---|---|---|
| Products | products: SKU, description, base unit, type (finished good, or a generic article with its variants), **list price**, **stock** per warehouse (one per Commerce inventory source); **committed** (open on orders not canceled or invoiced) and **available** (on hand less committed) are derived on read, never stored (`lib/availability.js`); a **sales status** (sellable, or blocked for sales — the ERP's own, kept across imports; a blocked product ships nothing) | filled from Commerce by Demo Builder; edited here for the demo, and every Commerce change overwrites the ERP again, except the sales status, which Commerce does not carry |
| Business partners | accounts (sold-to): name, **sales organizations** (the websites the company buys through), legal identity (legal name, VAT/tax id, reseller id, legal address, website), payment terms, **credit limit**, two separate stop switches: the **credit block** (`blocking`: None · Stop shipping · Stop invoicing · Stop all), set only here and never changed by Commerce, and the **website account** (`websiteAccount`: Active · Closed), Commerce's company Active/Blocked switch copied here read-only (contract version 5: `websiteAccountClosed` on the import). Either one stops an order; credit exposure is derived from open orders, never stored | filled from Commerce by Demo Builder, then kept current by Commerce's company event (companies, credit, website account, legal fields, the admin's website; never the credit block); edited here for the demo; one default partner for walk-in customers, in every sales organization |
| Customer price lists | Business Central's sales price lists: a number (`4000000001`+), applies to **one customer or one customer price group**, a term (starting date, optional ending date), a status (Draft · Active · Inactive) and lines, each a product with an **agreed price** or a **line discount**, a **from quantity** and optional dates of its own. Stored as `contracts` (the name the integration calls) | created here |
| Customer price groups | a code and a name; a customer belongs to at most one (`priceGroup` on the business partner) | created here; a customer's group is set on its page, never by an import |
| Pricing conditions | loose rules: contract prices, contract discounts, max-discount ceilings; they price the storefront too, through the prices in force (see Customer prices) | created here |
| Sales orders | created by the integration from Commerce orders; confirmed, shipped (in parts — each a **shipment** document, `8000000001`+), invoiced once whole (an **invoice** document, `9000000001`+) or canceled here. Only the header word and the quantities are stored; shipping, billing and the outward `status` are derived from them | numbers are the ERP's, never reused |
| Events | the ERP's outbound event log: every change it publishes (price, stock, credit limit, block, order status), delivered or pending | |
| Settings | display name; the end of a maintenance window, if one runs (see Maintenance window below); warehouse names of the ERP's own (a code seen in an import takes the Commerce source name once); the structure the last fill sent (websites and their sales organizations); and the ERP's **setup**, the Settings page (AB-59, `lib/setup.js`): **Company** (code, name, address, tax ID, currency: the seller on every invoice, the company code and currency health answers; a field never set falls back to the home website's Store Information), **Sales & receivables** (default payment terms, taken by a customer the ERP creates and billing one with none; credit warnings, what a new order's credit decision checks: the credit limit, an overdue balance, both or none; return reason codes, which code each return line), **Number series** (each document type's next number, forward only) and **Sales organizations** (the ERP's own: code, name, currency, website; seeded by the first fill while it has none, then edited here; `lib/sales-organizations.js`). Wipe and maintenance are Demo Builder's, on the ERP's card; their routes stay and the ERP's screen no longer shows them. Appearance (theme and color) is the SC's preference, not a setting: the user menu at the end of the screen's shell bar opens it, previews each pick live, and saves with `PATCH settings { appearance: { theme?, palette? } }` | the setup is the ERP's: a fill never changes it, and a wipe leaves it |

Records are transitory, and Commerce is the master the demo is prepared in: the ERP only
looks like the system of record. Every import (at install, on a Commerce change, on reset)
overwrites the fields it carries. `POST admin/wipe` removes everything except the settings
and the order-number counter; the integration then re-imports from Commerce. The counter never
rewinds, so an order number a Commerce order carries from before a reset cannot collide.

**What the Commerce instance needs for each story** (one ERP, the business structure, two
ERPs) is written for the SC in the integration's
[`docs/demo-setup.md`](https://github.com/skukla/commerce-erp-integration/blob/main/docs/demo-setup.md),
with the Admin path, the API check and the undo for every requirement.
The walk-through of the demo itself, ERP screen by screen and then Commerce from the other side,
is [`docs/walkthrough.md`](https://github.com/skukla/commerce-erp-integration/blob/main/docs/walkthrough.md)
in the same repository.

## API

Web actions under one runtime package, all `require-adobe-auth` (a caller presents an IMS token
from the same org; the integration uses the server-to-server credential Demo Builder injects). The
one exception is `screen`, below, which serves the ERP's own page.

| Action | Routes |
|---|---|
| `health` | `GET` name, `maintenance` (null, or `{ until, message }` while a maintenance window runs), counts, last import/wipe, the work waiting (Home's cues), and `structure`: the company code (as Settings holds it), each sales organization with its name, currency, website and counts (the ERP's own, plus any a customer or order names), each warehouse with its ERP name, Commerce source name and product count (`lib/structure.js`) |
| `settings` | `GET`, `GET /setup` and `PATCH /setup { company?, sales?, numberSeries?: { [type]: { next } } }` (the Settings page; every field checked before any is kept, a refusal in words), `POST /sales-organizations { code, name, currency, websiteCode? }` and `PATCH /sales-organizations/:code { name?, currency?, websiteCode? }` (each answering the setup), `PATCH { appearance?, timeZone?, warehouses?: { [code]: { name } } }` (the name is fixed when the ERP is added; a `displayName` is refused) (rename a warehouse; Commerce keeps its own source name) (`timeZone`, an IANA name, default UTC: the ERP's local date, which decides the day a price line is in force); `POST /maintenance { minutes? }` starts a maintenance window (1 to 1440 minutes, default 30; starting again restarts it), `DELETE /maintenance` ends it |
| `admin` | `POST /wipe`, `POST /import { products[], partners[], stock[], structure?, projectName?, origin? }` (any of the three arrays; `stock` moves quantities per warehouse on products the ERP has; `structure.websites[]` is what Demo Builder's fill saw, kept as `settings.structureMirror`; `origin: { system, document? }` names the system and document behind a partial import) |
| `products` | `GET` (each with `committed` and `available`), `GET /:sku` (plus `openOrders`: each order holding it, with the customer named), `PATCH /:sku { name?, listPrice?, warehouses?: [{ code, quantity }], salesStatus? }`, `DELETE /:sku` (a product deleted in Commerce) |
| `partners` | `GET`, `GET /:id` (the customer document: the record plus `credit` { limit, exposure, openOrders, openItems, available, held } — null for the walk-in customer; exposure is its open orders plus what is open on its invoices — its `openItems` (unpaid invoices with due date and open amount), its `orders`, its `conditions` and `contracts`: the price lists that apply to it, its own then its price group's), `PATCH /:id { creditLimit?, blocking?, paymentTerms?, priceGroup? }` (`priceGroup` a group's code, or null for none) (a quote or order names its customer by number, `partnerId`; without one it is the walk-in customer's. Since contract version 3 the ERP holds no Commerce id: which Commerce company is which customer is the integration's key map) |
| `pricing` | `GET` conditions, `POST` a condition (`kind`, `partnerId?`, `sku?`, `price` or `percent`, `validFrom?`, `validTo?`, `minQty?`, `salesOrg?` — a scope to one sales organization; blank means every one), `DELETE /:id`, `POST /quote { partnerId?, lines:[{sku, qty}], date?, salesOrg? }` (a scoped condition applies only to a quote through its sales organization; price lists come first, see Customer prices below; each quote line names `contractNumber`, the price list that priced it, or null) |
| `contracts` | customer price lists: `GET` (`?partnerId=` or `?priceGroup=`), `GET /in-force` (`?partnerId=`), `GET /:number`, `POST { appliesTo?, partnerId \| priceGroup, description?, startingDate, endingDate?, lines? }` (a draft; `appliesTo` is `customer`, the default, or `priceGroup`), `PATCH /:number { description?, startingDate?, endingDate?, lines? }` (while draft or active), `POST /:number/activate`, `POST /:number/deactivate`; price groups: `GET /price-groups`, `POST /price-groups { code, name }`, `DELETE /price-groups/:code` (refused while a customer or a price list uses it). A line is `{ sku, kind: price \| discount, price \| percent, minQty (1), startingDate?, endingDate? }` |
| `orders` | `GET`, `GET /:number` (the document: derived `status`, `shippingStatus`, `billingStatus`, `overall`, `can`, its `shipments`, `invoice` (with what is open on it), `creditMemos`, `returnOrders` and `payments`), `POST { purchaseOrderByCustomer, partnerId?, lines:[{ sku, qty, price, customerLineReference? }], currency?, total?, salesOrg?, salesOrgName? }` (idempotent on the customer's order number; the sales organization is the website's, sent by the integration, `1000` when absent; the sold-to partner is widened to it), `POST /:number/confirm`, `POST /:number/cancel { reason }`, `POST /:number/shipments { lines:[{item, qty}], warehouse? }`, `POST /:number/shipments/:shipment/post` (the goods issue: the shipped quantity leaves the shipment's warehouse, refused when it holds less; no stock event is raised, because the shipment event already tells the web shop what left), `POST /:number/lines/:item/close { reason }`, `POST /:number/invoice`, `POST /:number/credit-memo` (credits the whole invoice, once: the invoice then reads `credited`), `POST /:number/credit/release`, `POST /:number/credit/reject` (an over-limit or blocked customer's order is created and HELD, not refused; a hold stops Confirm until released, and Reject cancels with the reason Credit rejected), `POST /:number/credit/hold { reason?, origin }`, `POST /:number/status { status, reason? }` (the whole-order move; predates shipments and stays). Moves that happened in another system (the web shop) first carry `origin: { system, document?, eventId? }` and raise no outbound event: `POST /:number/external-shipment { externalReference, lines:[{ customerLineReference, qty }], warehouse?, origin }`, `POST /:number/external-invoice { externalReference?, origin }`, cancel with the reason `Canceled in the web shop`, `credit/hold` and `credit/release` |
| `shipments` | `GET`, `GET /:number` — read-only; a shipment is created and posted on its order |
| `invoices` | `GET`, `GET /:number` (each with `openAmount`, `paidAmount`, `paymentStatus` — open, partly paid, paid or credited — and its `payments`, derived from the payments and credit memos), `POST /:number/payments { amount, reference? }` (contract version 14: an incoming payment, more than 0 and at most the open amount; 201 with the payment; `IncomingPayment.Posted` is raised); the invoice is created on its order |
| `returns` | return orders (contract version 13): `GET` (newest first), `GET /:number`, `POST { customerReturnReference, orderNumber, lines:[{ customerLineReference, qty, reason? }], origin? }` (idempotent on `customerReturnReference`: 201, then 200 with the same return order; a line is refused when it is not on the sales order or asks for more than was invoiced less what earlier returns took; reason defaults to `Customer return`), `POST /:number/receive` (the goods are back: stock goes up at the warehouse the order shipped from, and `CustomerReturn.Changed` is raised), `POST /:number/credit-memo` (credits the received lines). A return order is open, received, then credited |
| `credit-memos` | `GET`, `GET /:number` — read-only; a credit memo is created on its order or its return order |
| `payments` | `GET` (newest first), `GET /:number` — read-only; a payment (numbered from 7000000001) is posted on its invoice and cannot be undone; a wipe removes them |
| `events` | `GET` the event log (newest first, with the subscriber address, the pending and the failed counts), `POST /retry` redeliver pending events, `POST /requeue` give failed events another ten attempts |
| `search` | `GET ?q=` the documents that match what was typed, best first (the shell's search bar) |

Errors are `{ status: 'ERROR', errorCode, errorMessage }` with a 400/404/503/500.

## Maintenance window

A real ERP has maintenance windows, when its interfaces answer "unavailable"; so does this one
(`lib/maintenance.js`). While a window runs, every route of every action except `health` and
`settings` answers `503 { errorCode: 'ERP_MAINTENANCE', errorMessage: 'Contoso ERP is in
maintenance until 14:30 UTC.', maintenanceUntil }`, the time told in the ERP's own time zone.
Reads and writes alike are refused and pending events wait for the window to end. `health` still
answers, with `maintenance: { until, message }`, so the integration can say why the ERP cannot be
used; `settings` still answers, because it starts and ends the window. The screen still opens and
shows a banner with the end time. The window ends by itself: an end time that has passed counts
as off, so a window nobody ended cannot break the next demo. Start and end it from the ERP's card in Demo Builder, or with
`POST settings/maintenance` and `DELETE settings/maintenance`.

## Customer prices

Modeled on Business Central's sales price lists, decided with the owner on 2026-09-28, with SAP's
access sequence underneath (`lib/contract-prices.js`):

- **In force.** A price list prices only when it is Active and today is inside its dates, and a
  line only inside its own dates too (both days included; a blank end is open). Draft and
  Inactive lists price nothing. A list or line that starts or ends with the calendar needs no
  change to do so.
- **Most specific first.** For each product and from quantity: the customer's own price lists;
  then its price group's lists, for what its own do not price; then the loose pricing
  conditions; then the list price. The maximum discount (a loose, store-wide rule) still caps
  the result. When a price list prices a product for the customer, the customer's loose prices
  and discounts are set aside for that product.
- **Ties.** Two lines for the same product and from quantity at one level: the one that started
  later wins (the line's starting date, else its list's), then the higher list number. So "this
  price goes up on 1 January" is one dated line beside the old one.
- **Quantity breaks.** A quote prices the line with the highest from quantity the quantity
  reaches; below every one, the list price stands.

`GET contracts/in-force` answers what the ERP would charge each customer today, by the order
above (`lib/net-prices.js`, which reads the same decision a quote does, `decide` in
`lib/pricing.js`):
`{ items: [{ partnerId, lines: [{ sku, kind, price | percent, minQty, contractNumber, appliesTo }] }] }`,
where `contractNumber` is the price list and `appliesTo` says whether it is the customer's own
(`customer`) or its group's (`priceGroup`); a line a loose pricing condition set has
`contractNumber: null` and `appliesTo: customer`. Customers with no line are left out; with
`?partnerId=` it answers that one customer, its lines possibly empty.

- **Pricing conditions reach the storefront.** A customer's loose contract price or discount
  counts on today's date and from its minimum quantity, like a list line. An all-products
  discount is one line per product the ERP sells (a configurable parent sells nothing; its
  variants are priced), so a 10% discount for a customer is one line for every variant and
  simple product.
- **A discount stays a discount.** It is sent as a `discount` line, so Commerce keeps it
  following the list price. A fixed price stays a `price` line.
- **The maximum discount is applied, not passed on.** A discount above the ceiling is sent
  at the ceiling's percent; a fixed price below list × (1 − ceiling) is raised to that floor
  and sent as the ceiling's discount, which is the same price and follows the list price.
- **Quantity breaks.** A product's breaks are the minimum quantities of its list lines and
  conditions; a break is a line only where the charged price moves.

## Events

A real ERP publishes what changed in it, and so does this one. Every change made on its
screen (price, stock, credit limit, block, order status) is journaled as an event and posted
at once to the subscriber, a web shop integration's ingestion webhook. Since contract version
16 each is a CloudEvents 1.0 envelope (`specversion, id, source, type, time, datacontenttype,
data`), as SAP sends its own: `source` is `/erp/<ERP_ID>` (or `/erp`), the `type` is object +
action in the ERP's words (`SalesOrder.Changed`, `OutboundDelivery.GoodsIssueStatusChanged`,
`BillingDocument.Created` for an invoice or a credit memo, `CustomerReturn.Changed`,
`IncomingPayment.Posted`, `Product.Changed`, `ProductStock.Changed`, `Customer.Changed`,
`PriceList.Changed`), and `data` is the ERP's whole record in its own words. No web shop name
or id appears: the shop's numbers ride on the ERP's documents only as the customer's references
(`purchaseOrderByCustomer`, `customerLineReference`, `customerReturnReference`,
`externalReference`), and translating is the subscriber's job. The journal names each event the
same way ("Sales order changed", "Goods issue posted", "Billing document created (credit
memo)", "Product changed: name, list price").

`PriceList.Changed` is raised for every customer
whose prices in force a change moved: a list's create, edit, activation or deactivation (a
group's list reaches every member whose prices moved), a customer moved into or out of a
price group, a pricing condition created, changed or deleted (one naming no customer, such as
a store-wide maximum discount, is checked against every customer), and a list price edited on
the product page (a fixed price the maximum discount holds up sits at list × (1 − ceiling),
so it moves with the list price; discounts follow it by themselves). A fill or an import that
changes list prices raises none of these; the integration's hourly publish reads
`contracts/in-force`. It carries `{ Customer, Lines }`, that customer's whole set as
`contracts/in-force` answers it, so a replay is harmless and an empty `Lines` means the
customer pays list price for everything. A change that moves no price raises nothing, and nor does the calendar: a
subscriber that follows dates reads `contracts/in-force`. Undelivered events are retried every minute; after ten failed
attempts an event is marked failed and left alone until someone requeues it from the Events
page.

The subscriber's address is not configured: both apps live in the same App Builder
workspace, so it follows from the ERP's own namespace
(`https://<namespace>.adobeio-static.net/api/v1/web/ingestion/webhook`; `EVENTS_WEBHOOK_URL`
overrides it). The call carries the ERP's own IMS token, so nothing is shared between the
two apps, and the ERP holds nothing that ties it to one Commerce instance: wipe it and it
starts again.

An ERP in a workspace of its own cannot reach its integration that way: the ingestion action
accepts only its own workspace's technical account. Such an ERP is deployed with the
integration's address (`EVENTS_WEBHOOK_URL`) and a publishing credential from the
integration's workspace (`EVENTS_AUTH_CLIENT_ID`, `EVENTS_AUTH_CLIENT_SECRET`,
`EVENTS_AUTH_ORG_ID`, `EVENTS_AUTH_SCOPES` as a JSON array), and signs its event posts with it,
the way a real ERP posts to middleware with a credential the middleware issued. Demo Builder
sets all five when it deploys an added ERP; without them the ERP signs with its own.

## The contract

[`contract/erp-contract.json`](contract/erp-contract.json) states what the ERP promises its
subscribers: its routes, the shapes of an import, a quote and an order, every event it
publishes with the keys its payload carries, and the delivery rules. `test/contract.test.js`
fails when the code drifts from it, and the Commerce integration vendors a copy and tests its
handlers against it, so the two repositories cannot drift apart silently. Version 2
(2026-09-24) names the business-structure fields: a partner's sales organizations, legal
identity and website; a `structure` import of Commerce's websites and Store Information; a
sales organization on the order. Version 6 (2026-09-28) adds the price lists (route
`contracts`), their prices in force and `be-observer.company_contract_update`; version 7 the
same day adds price groups, lists for a customer or a group, dated lines, and `appliesTo` on
each line in force. Version 8 (2026-09-28) adds the maintenance window: its two routes, which actions stay open, health's `maintenance` field and the 503 every other route answers. Version 9 (2026-09-28) makes the prices in force and `be-observer.company_contract_update` what the ERP would charge: pricing conditions and the maximum discount included, raised also when a condition or a list price changes. Version 10 (2026-09-28) puts the last British values in American English: status `canceled`, event kind `order.canceled`, reason `Canceled in Commerce`. The old spellings are refused on the wire; orders and journal entries stored with them read as the new ones. Version 13 (2026-10-02) adds return orders (route `returns`, numbered from 6000000001) and credit memos (route `credit-memos`, numbered from 9500000001; `POST orders/:number/credit-memo` credits a whole invoice), with `be-observer.sales_order_creditmemo_create` and `be-observer.rma_status_update`. Version 14 (2026-10-02) makes an invoice an open item until it is paid: `POST invoices/:number/payments` posts an incoming payment (route `payments`, numbered from 7000000001) and raises `be-observer.sales_order_payment_create`, and a customer's credit exposure becomes its open orders plus its open items. Version 15 (2026-10-02) adds the ERP's setup (`settings`: `GET /setup`, `PATCH /setup`, `POST /sales-organizations`, `PATCH /sales-organizations/:code`), credit warnings that can hold an order for an overdue balance, and a `reasonCode` on each return line. Version 16 (2026-10-02, AB-26y) makes the ERP speak its own language: CloudEvents of its own types with its own records as data, the customer's references where the shop's ids were, `origin: { system, document? }` on what another system sent, and the routes `external-shipment` and `external-invoice`; records stored before it read in its names (`lib/legacy.js`). `test/records-shape.test.js` pins what the ERP STORES
against `test/fixtures/record-shapes.json`, so a field can only appear or vanish on purpose
(`UPDATE_RECORD_SHAPES=1` rewrites the fixture; review the diff).

## Storage

App Builder Database, provisioned by the deploy (`runtimeManifest.database`). One database per
workspace; the region is pinned in `app.config.yaml`. The Console project needs the
**App Builder Data Services** API; Demo Builder adds it when it installs the component.

## Develop

```bash
npm install
npm test            # node --test: pricing, orders, records, actions against an in-memory database
aio app deploy      # into the workspace `aio app use` points at
```

Two deploy-time inputs: `ERP_DISPLAY_NAME`, what the ERP calls itself (default "Acme ERP"), and
`ERP_SCREEN_KEY`, the key that opens the screen. Demo Builder writes the name from what the SC
enters and generates the key; by hand, set both in the app's env file before deploying. A redeploy with a new name renames the ERP unless someone renamed it on its screen.

A third, optional input: `ERP_ID`, the id the Commerce integration's ERP list gives this ERP
when it serves several (lower-case letters, digits and hyphens, e.g. `brand-b`). With it, every
event the ERP delivers names the ERP (`erpId`, contract version 4), so the integration knows
which ERP spoke; a stock event, whose value is a list, is sent as it is, and the integration
finds its ERP from the product that owns each line. Without it the events are exactly as before, and the integration reads them as
its single ERP's. Demo Builder sets it when an SC adds another ERP.

### Every screen, looked at by a machine

`test/screens.test.js` starts the preview on a free port, drives Playwright's headless
Chromium through every area and the first document behind each list, and asserts per
screen: it rendered, the console is clean, and its computed-style fingerprint equals the
one in `test/fixtures/screen-fingerprints.json`. A CSS or layout change therefore has to
be accepted on purpose:

```bash
npx playwright install chromium                          # once per machine
UPDATE_SCREEN_FINGERPRINTS=1 node --test test/screens.test.js   # after an intended change; review the fixture diff
```

It runs with `npm test`. The fingerprint is taken once the screen has stopped moving (three
samples 300 ms apart that agree, with the pointer parked off the grid and element sizes left
out, since Spectrum's headers settle a fraction of a pixel apart between runs). A screen that
differs on one load is loaded once more in a fresh page and fails only when it differs twice;
the rows behind every fingerprint are written under the OS temp directory
(`demo-erp-screen-rows/`), and a first mismatch is kept beside them as `<screen>.mismatch.txt`
for diffing.

### Home, the rail counts and the shell search

Home is a work list, not a set of record counts: each cue (orders to confirm, on credit
hold, to ship, to invoice; shipments to post; blocked customers; events not delivered or
waiting) is counted by `lib/work.js` from the same abilities the documents' own buttons
read, and opens its list filtered to exactly those rows (`#orders?work=toShip`). The rail
carries the same numbers as small counts. The shell bar's search (`actions/search`) finds
any document by number, SKU or customer name and opens it on its own list page
(`#orders?open=0000001003`); the Event Journal names the document each entry belongs to
(`lib/journal.js`), links it, and refreshes itself while open.

## The screen

How the ERP and its integration fit together:

```
 ONE Adobe Developer Console workspace  =  ONE Runtime namespace  =  ONE static site
 ═══════════════════════════════════════════════════════════════════════════════════

 demo-erp repo (Demo Builder component: "ERP", kind system)
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ screen/            React UI source ──build──┐                                  │
 │                                             ▼                                  │
 │ actions/screen/    serves page + app.js + app.css      ◄── key-protected door  │
 │                    and /api/<name> ─────────┐              (no Adobe sign-in)  │
 │                                             │ same handler, in-process         │
 │ actions/health, products, partners, …  ◄────┘          ◄── IMS-protected door │
 │                                                             (require-adobe-auth)│
 │ lib/               ALL business logic (pricing, orders, events, ledger)        │
 │                         │                                                      │
 │                         ▼                                                      │
 │                  App Builder Database (the ERP's records)                      │
 └──────────────────────────────────────────────────────────────────────────────┘
        ▲ key in link                                  ▲ server-to-server token
        │                                              │ (ERP_BASE_URL)
  ┌─────┴───────────────┐                              │
  │ SC's browser tab    │                              │
  │ "Open ERP" in       │                              │
  │ Demo Builder        │                              │
  └─────────────────────┘                              │
                                                       │
 commerce-erp-integration repo (Demo Builder component: "ERP integration")
 ┌─────────────────────────────────────────────────────┼────────────────────────┐
 │ src/commerce-backend-ui-2/web-src/  Admin UI SDK React UI                     │
 │        │ build + deploy                             │                         │
 │        ▼                                            │                         │
 │   STATIC SITE  <namespace>.adobeio-static.net       │  (only this app uses it)│
 │                                                     │                         │
 │ src/commerce-extensibility-1/actions/               │                         │
 │   erp/status, detach, move-stock, …  ───────────────┘                         │
 │   webhooks (prices, discounts, order create) ◄── Commerce calls these         │
 │   app-management/* (install, config)        ◄── Commerce App Management       │
 │ src/lib/erp.js      the ERP client                                            │
 └──────────────────────────────────────────────────────────────────────────────┘
        ▲ loads the page from the static site; hands it the user's token
        │                               page ──calls──► erp/* actions
  ┌─────┴───────────────────────────────┐
  │ Commerce Admin                      │
  │  Apps ▸ <ERP> ▸ Integration (iframe)│
  └─────────────────────────────────────┘
```

React only draws the pages; every rule lives in `lib/` and runs in Adobe I/O Runtime. The page
runs in the browser of whoever opened it.

The screen (`screen/`) is React Spectrum, served by the `screen` action rather than App Builder's
static site:

| Path | Answers |
|---|---|
| `screen/` | the page |
| `screen/app.js`, `screen/app.css` | the built screen |
| `screen/api/<action>/…` | that action's own handler, run in-process, behind the key |

Why not the static site: the ERP deploys into the same Runtime namespace as its integration, a
namespace has one static site, and `aio app deploy` empties it before uploading. Two apps with web
assets delete each other's screens. That is also why the folder is not called `web-src/`: `aio`
treats a folder with that name as a front end even when the config does not mention it.

`screen` has no Adobe sign-in. Its data calls need the key, sent as the `x-erp-screen-key` header;
the page takes it from the `?key=` in the link Demo Builder opens, keeps it for the tab, and removes
it from the address bar. With no key configured, every data call is refused.

The `pre-app-build` hook builds `screen/` with esbuild (`npm run build:screen`). Runtime answers at
most 1 MB per result, so the build refuses a script or stylesheet near that size.

## License

Apache-2.0. See `NOTICE` for the pieces adapted from elsewhere.
