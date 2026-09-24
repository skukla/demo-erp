# demo-erp

A mock ERP, modelled on SAP, that runs as an Adobe App Builder app. It is a Demo Builder
**system** component: it ships with the Commerce ERP integration
([skukla/commerce-erp-integration](https://github.com/skukla/commerce-erp-integration)),
is installed and removed with it, and knows nothing about Commerce itself.

What it holds, in SAP's words:

| Collection | What it is | Who owns the values |
|---|---|---|
| Products | products: SKU, description, plant, **list price**, **stock** | mirrored from Commerce; edited here for the demo, and every Commerce change overwrites the ERP again |
| Business partners | accounts (sold-to): name, **sales organisations** (the websites the company buys through), legal identity (legal name, VAT/tax id, reseller id, legal address, website), payment terms, **credit limit**, **blocking** (open · shipping · invoicing · all — Commerce's boolean imports as all); credit exposure is derived from open orders, never stored | mirrored from Commerce (companies, credit, status, legal fields, the admin's website); edited here for the demo; one default partner for walk-in customers, in every sales organisation |
| Pricing conditions | contract prices, contract discounts, max-discount ceilings | created here |
| Sales orders | created by the integration from Commerce orders; confirmed, shipped (in parts — each a **shipment** document, `8000000001`+), invoiced once whole (an **invoice** document, `9000000001`+) or cancelled here. Only the header word and the quantities are stored; shipping, billing and the outward `status` are derived from them | numbers are the ERP's, never reused |
| Events | the ERP's outbound event log: every change it publishes (price, stock, credit limit, block, order status), delivered or pending | |
| Settings | display name; warehouse names of the ERP's own (a code seen in an import takes the Commerce source name once); the structure the last mirror sent (websites and their sales organisations); Sync records and Wipe all records. The Organisation card (company code, sales organisations with counts, warehouses) is derived on read (`lib/structure.js`) | |

Records are transitory, and Commerce is the master the demo is prepared in: the ERP only
looks like the system of record. Every import (at install, on a Commerce change, on reset)
overwrites the fields it carries. `POST admin/wipe` removes everything except the settings
and the order-number counter; the integration then re-imports from Commerce. The counter never
rewinds, so an order number a Commerce order carries from before a reset cannot collide.

## API

Web actions under one runtime package, all `require-adobe-auth` (a caller presents an IMS token
from the same org; the integration uses the server-to-server credential Demo Builder injects). The
one exception is `screen`, below, which serves the ERP's own page.

| Action | Routes |
|---|---|
| `health` | `GET` name, counts, last import/wipe |
| `settings` | `GET`, `PATCH { displayName? }` |
| `admin` | `POST /wipe`, `POST /import { products[], partners[], projectName? }` |
| `products` | `GET`, `GET /:sku`, `PATCH /:sku { listPrice?, stock? }` |
| `partners` | `GET`, `GET /:id` (the customer document: the record plus `credit` { limit, exposure, available } — null for a customer with no Commerce company — its `orders` and its `conditions`), `PATCH /:id { creditLimit?, blocking?, paymentTerms? }` (import rows may carry `emailDomain`; quotes resolve the partner by id, company, email domain, then customer group) |
| `pricing` | `GET` conditions, `POST` a condition, `DELETE /:id`, `POST /quote { partnerId? \| commerceCompanyId? \| customerGroupId?, lines:[{sku, qty}] }` |
| `orders` | `GET`, `GET /:number` (the document: derived `status`, `shippingStatus`, `billingStatus`, `overall`, `can`, its `shipments` and `invoice`), `POST { commerceOrderId, commerceIncrementId?, partnerId?, lines, currency?, total? }` (idempotent), `POST /:number/confirm`, `POST /:number/cancel { reason }`, `POST /:number/shipments { lines:[{item, qty}], warehouse? }`, `POST /:number/shipments/:shipment/post`, `POST /:number/lines/:item/close { reason }`, `POST /:number/invoice`, `POST /:number/credit/release`, `POST /:number/credit/reject` (an over-limit or blocked customer's order is created and HELD, not refused; a hold stops Confirm until released, and Reject cancels with the reason Credit rejected), `POST /:number/status { status, reason? }` (the whole-order move; predates shipments and stays) |
| `shipments` | `GET`, `GET /:number` — read-only; a shipment is created and posted on its order |
| `invoices` | `GET`, `GET /:number` — read-only; the invoice is created on its order |
| `events` | `GET` the event log (newest first, with the subscriber address, the pending and the failed counts), `POST /retry` redeliver pending events, `POST /requeue` give failed events another ten attempts |

Errors are `{ status: 'ERROR', errorCode, errorMessage }` with a 400/404/503/500.

## Events

A real ERP publishes what changed in it, and so does this one. Every change made on its
screen (price, stock, credit limit, block, order status) is journaled as an event in the
starter kit's back-office vocabulary (`be-observer.catalog_product_update`,
`be-observer.catalog_stock_update`, `be-observer.sales_order_status_update`,
`be-observer.sales_order_shipment_create`, `be-observer.sales_order_invoice_create`,
`be-observer.sales_order_cancel`, `be-observer.company_credit_update`,
`be-observer.company_status_update`) and posted at once to the subscriber, the Commerce
integration's ingestion webhook. Undelivered events are retried every minute; after ten failed
attempts an event is marked failed and left alone until someone requeues it from the Events
page.

The subscriber's address is not configured: both apps live in the same App Builder
workspace, so it follows from the ERP's own namespace
(`https://<namespace>.adobeio-static.net/api/v1/web/ingestion/webhook`; `EVENTS_WEBHOOK_URL`
overrides it). The call carries the ERP's own IMS token, so nothing is shared between the
two apps, and the ERP holds nothing that ties it to one Commerce instance: wipe it and it
starts again.

## The contract

[`contract/erp-contract.json`](contract/erp-contract.json) states what the ERP promises its
subscribers: its routes, the shapes of an import, a quote and an order, every event it
publishes with the keys its payload carries, and the delivery rules. `test/contract.test.js`
fails when the code drifts from it, and the Commerce integration vendors a copy and tests its
handlers against it, so the two repositories cannot drift apart silently. Version 2
(2026-09-24) names the business-structure fields: a partner's sales organisations, legal
identity and website; a `structure` import of Commerce's websites and Store Information; a
sales organisation on the order. `test/records-shape.test.js` pins what the ERP STORES
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
 │   erp/status, mirror, reset, …  ────────────────────┘                         │
 │   webhooks (prices, discounts, order create) ◄── Commerce calls these         │
 │   app-management/* (install, config)        ◄── Commerce App Management       │
 │ src/lib/erp.js      the ERP client                                            │
 └──────────────────────────────────────────────────────────────────────────────┘
        ▲ loads the page from the static site; hands it the user's token
        │                               page ──calls──► erp/* actions
  ┌─────┴──────────────────────────────┐
  │ Commerce Admin                     │
  │  System ▸ ERP integration  (iframe)│
  └────────────────────────────────────┘
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
