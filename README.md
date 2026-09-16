# demo-erp

A mock ERP, modelled on SAP, that runs as an Adobe App Builder app. It is a Demo Builder
**system** component: it ships with the Commerce ERP integration
([skukla/commerce-erp-integration](https://github.com/skukla/commerce-erp-integration)),
is installed and removed with it, and knows nothing about Commerce itself.

What it holds, in SAP's words:

| Collection | What it is | Who owns the values |
|---|---|---|
| Products | products: SKU, description, plant, **list price**, **stock** | mirrored from Commerce; edited here for the demo, and every Commerce change overwrites the ERP again |
| Business partners | accounts (sold-to): name, sales org, payment terms, **credit limit**, credit used, **blocked** | mirrored from Commerce (companies, credit, status); edited here for the demo; one default partner for walk-in customers |
| Pricing conditions | contract prices, contract discounts, max-discount ceilings | created here |
| Sales orders | created by the integration from Commerce orders; **status** moved here (created → confirmed → shipped → invoiced, or cancelled) | number is the ERP's, never reused |
| Events | the ERP's outbound event log: every change it publishes (price, stock, credit limit, block, order status), delivered or pending | |
| Settings | display name, **offline** switch (every record request answers 503, the way an unavailable system looks; a test control, not a demo scene) | |

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
| `health` | `GET` name, offline, counts, last import/wipe |
| `settings` | `GET`, `PATCH { displayName?, offline? }` |
| `admin` | `POST /wipe`, `POST /import { products[], partners[], projectName? }` |
| `products` | `GET`, `GET /:sku`, `PATCH /:sku { listPrice?, stock? }` |
| `partners` | `GET`, `GET /:id`, `PATCH /:id { creditLimit?, blocked?, paymentTerms? }` (import rows may carry `emailDomain`; quotes resolve the partner by id, company, email domain, then customer group) |
| `pricing` | `GET` conditions, `POST` a condition, `DELETE /:id`, `POST /quote { partnerId? \| commerceCompanyId? \| customerGroupId?, lines:[{sku, qty}] }` |
| `orders` | `GET`, `GET /:number`, `POST { commerceOrderId, commerceIncrementId?, partnerId?, lines, currency?, total? }` (idempotent), `POST /:number/status { status }` |
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
handlers against it, so the two repositories cannot drift apart silently.

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
