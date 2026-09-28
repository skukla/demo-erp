# demo-erp

A mock ERP, modelled on SAP, that runs as an Adobe App Builder app. It is a Demo Builder
**system** component: it ships with the Commerce ERP integration
([skukla/commerce-erp-integration](https://github.com/skukla/commerce-erp-integration)),
is installed and removed with it, and knows nothing about Commerce itself.

What it holds, in SAP's words:

| Collection | What it is | Who owns the values |
|---|---|---|
| Products | products: SKU, description, base unit, type (finished good, or a generic article with its variants), **list price**, **stock** per warehouse (one per Commerce inventory source); **committed** (open on orders not cancelled or invoiced) and **available** (on hand less committed) are derived on read, never stored (`lib/availability.js`); a **sales status** (sellable, or blocked for sales — the ERP's own, kept across imports; a blocked product ships nothing) | filled from Commerce by Demo Builder; edited here for the demo, and every Commerce change overwrites the ERP again, except the sales status, which Commerce does not carry |
| Business partners | accounts (sold-to): name, **sales organisations** (the websites the company buys through), legal identity (legal name, VAT/tax id, reseller id, legal address, website), payment terms, **credit limit**, two separate stop switches: the **credit block** (`blocking`: None · Stop shipping · Stop invoicing · Stop all), set only here and never changed by Commerce, and the **website account** (`websiteAccount`: Active · Closed), Commerce's company Active/Blocked switch copied here read-only (contract version 5: `websiteAccountClosed` on the import). Either one stops an order; credit exposure is derived from open orders, never stored | filled from Commerce by Demo Builder, then kept current by Commerce's company event (companies, credit, website account, legal fields, the admin's website; never the credit block); edited here for the demo; one default partner for walk-in customers, in every sales organisation |
| Customer price lists | Business Central's sales price lists: a number (`4000000001`+), applies to **one customer or one customer price group**, a term (starting date, optional ending date), a status (Draft · Active · Inactive) and lines, each a product with an **agreed price** or a **line discount**, a **from quantity** and optional dates of its own. Stored as `contracts` (the name the integration calls) | created here |
| Customer price groups | a code and a name; a customer belongs to at most one (`priceGroup` on the business partner) | created here; a customer's group is set on its page, never by an import |
| Pricing conditions | loose rules: contract prices, contract discounts, max-discount ceilings | created here |
| Sales orders | created by the integration from Commerce orders; confirmed, shipped (in parts — each a **shipment** document, `8000000001`+), invoiced once whole (an **invoice** document, `9000000001`+) or cancelled here. Only the header word and the quantities are stored; shipping, billing and the outward `status` are derived from them | numbers are the ERP's, never reused |
| Events | the ERP's outbound event log: every change it publishes (price, stock, credit limit, block, order status), delivered or pending | |
| Settings | display name; warehouse names of the ERP's own (a code seen in an import takes the Commerce source name once); the structure the last fill sent (websites and their sales organisations); Wipe all records. Demo Builder fills the ERP: when it is added, on Reset records, and with Load demo data on the ERP's card. The Sync records button, which asked the integration to copy Commerce again, was removed with that copy (2026-09-27). The Organisation card (company code, sales organisations with counts, warehouses) is derived on read (`lib/structure.js`); the Document numbering card shows each range's next number without reserving it (`lib/counters.js peek`); money with no currency of its own is shown in the company code's currency (health `currency`) | |

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
| `health` | `GET` name, counts, last import/wipe, the work waiting (Home's cues), and `structure`: the company code, each sales organisation with its website and counts, each warehouse with its ERP name, Commerce source name and product count (`lib/structure.js`, derived on read) |
| `settings` | `GET`, `PATCH { appearance?, warehouses?: { [code]: { name } } }` (the name is fixed when the ERP is added; a `displayName` is refused) (rename a warehouse; Commerce keeps its own source name) |
| `admin` | `POST /wipe`, `POST /import { products[], partners[], stock[], structure?, projectName?, origin? }` (any of the three arrays; `stock` moves quantities per warehouse on products the ERP has; `structure.websites[]` is what Demo Builder's fill saw, kept as `settings.structureMirror`; `origin: { event }` names the Commerce event behind a partial import) |
| `products` | `GET` (each with `committed` and `available`), `GET /:sku` (plus `openOrders`: each order holding it, with the customer named), `PATCH /:sku { name?, listPrice?, warehouses?: [{ code, quantity }], salesStatus? }`, `DELETE /:sku` (a product deleted in Commerce) |
| `partners` | `GET`, `GET /:id` (the customer document: the record plus `credit` { limit, exposure, available } — null for the walk-in customer — its `orders`, its `conditions` and `contracts`: the price lists that apply to it, its own then its price group's), `PATCH /:id { creditLimit?, blocking?, paymentTerms?, priceGroup? }` (`priceGroup` a group's code, or null for none) (a quote or order names its customer by number, `partnerId`; without one it is the walk-in customer's. Since contract version 3 the ERP holds no Commerce id: which Commerce company is which customer is the integration's key map) |
| `pricing` | `GET` conditions, `POST` a condition (`kind`, `partnerId?`, `sku?`, `price` or `percent`, `validFrom?`, `validTo?`, `minQty?`, `salesOrg?` — a scope to one sales organisation; blank means every one), `DELETE /:id`, `POST /quote { partnerId?, lines:[{sku, qty}], date?, salesOrg? }` (a scoped condition applies only to a quote through its sales organisation; price lists come first, see Customer prices below; each quote line names `contractNumber`, the price list that priced it, or null) |
| `contracts` | customer price lists: `GET` (`?partnerId=` or `?priceGroup=`), `GET /in-force` (`?partnerId=`), `GET /:number`, `POST { appliesTo?, partnerId \| priceGroup, description?, startingDate, endingDate?, lines? }` (a draft; `appliesTo` is `customer`, the default, or `priceGroup`), `PATCH /:number { description?, startingDate?, endingDate?, lines? }` (while draft or active), `POST /:number/activate`, `POST /:number/deactivate`; price groups: `GET /price-groups`, `POST /price-groups { code, name }`, `DELETE /price-groups/:code` (refused while a customer or a price list uses it). A line is `{ sku, kind: price \| discount, price \| percent, minQty (1), startingDate?, endingDate? }` |
| `orders` | `GET`, `GET /:number` (the document: derived `status`, `shippingStatus`, `billingStatus`, `overall`, `can`, its `shipments` and `invoice`), `POST { commerceOrderId, commerceIncrementId?, partnerId?, lines, currency?, total?, salesOrg?, salesOrgName? }` (idempotent; the sales organisation is the website's, sent by the integration, `1000` when absent; the sold-to partner is widened to it), `POST /:number/confirm`, `POST /:number/cancel { reason }`, `POST /:number/shipments { lines:[{item, qty}], warehouse? }`, `POST /:number/shipments/:shipment/post`, `POST /:number/lines/:item/close { reason }`, `POST /:number/invoice`, `POST /:number/credit/release`, `POST /:number/credit/reject` (an over-limit or blocked customer's order is created and HELD, not refused; a hold stops Confirm until released, and Reject cancels with the reason Credit rejected), `POST /:number/credit/hold { reason?, origin }`, `POST /:number/status { status, reason? }` (the whole-order move; predates shipments and stays). Moves that happened in Commerce first carry `origin: { event, eventId? }` and raise no outbound event: `POST /:number/commerce-shipment { commerceShipmentId, items:[{ orderItemId, qty }], sourceCode?, origin }`, `POST /:number/commerce-invoice { commerceInvoiceId?, origin }`, cancel with the reason `Cancelled in Commerce`, `credit/hold` and `credit/release` |
| `shipments` | `GET`, `GET /:number` — read-only; a shipment is created and posted on its order |
| `invoices` | `GET`, `GET /:number` — read-only; the invoice is created on its order |
| `events` | `GET` the event log (newest first, with the subscriber address, the pending and the failed counts), `POST /retry` redeliver pending events, `POST /requeue` give failed events another ten attempts |
| `search` | `GET ?q=` the documents that match what was typed, best first (the shell's search bar) |

Errors are `{ status: 'ERROR', errorCode, errorMessage }` with a 400/404/503/500.

## Customer prices

Modelled on Business Central's sales price lists, decided with the owner on 2026-09-28, with SAP's
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

`GET contracts/in-force` answers each customer's lines in force today, groups resolved:
`{ items: [{ partnerId, lines: [{ sku, kind, price | percent, minQty, contractNumber, appliesTo }] }] }`,
where `contractNumber` is the price list and `appliesTo` says whether it is the customer's own
(`customer`) or its group's (`priceGroup`). Customers with no line are left out; with
`?partnerId=` it answers that one customer, its lines possibly empty.

## Events

A real ERP publishes what changed in it, and so does this one. Every change made on its
screen (price, stock, credit limit, block, order status) is journaled as an event in the
starter kit's back-office vocabulary (`be-observer.catalog_product_update`,
`be-observer.catalog_stock_update`, `be-observer.sales_order_status_update`,
`be-observer.sales_order_shipment_create`, `be-observer.sales_order_invoice_create`,
`be-observer.sales_order_cancel`, `be-observer.company_credit_update`,
`be-observer.company_status_update`, `be-observer.company_contract_update`) and posted at once
to the subscriber, the Commerce integration's ingestion webhook.

`be-observer.company_contract_update` (kind `contract.changed`) is raised for every customer
whose price list prices in force a change moved: a list's create, edit, activation or
deactivation (a group's list reaches every member whose prices moved), and a customer moved
into or out of a price group. It carries `{ partnerId, lines }`, that customer's whole set as
`contracts/in-force` answers it, so a replay is harmless and an empty `lines` means no list
price is left. A change that moves no price raises nothing, and nor does the calendar: a
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
(2026-09-24) names the business-structure fields: a partner's sales organisations, legal
identity and website; a `structure` import of Commerce's websites and Store Information; a
sales organisation on the order. Version 6 (2026-09-28) adds the price lists (route
`contracts`), their prices in force and `be-observer.company_contract_update`; version 7 the
same day adds price groups, lists for a customer or a group, dated lines, and `appliesTo` on
each line in force. `test/records-shape.test.js` pins what the ERP STORES
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
which ERP spoke. Without it the events are exactly as before, and the integration reads them as
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

## Licence

Apache-2.0. See `NOTICE` for the pieces adapted from elsewhere.
