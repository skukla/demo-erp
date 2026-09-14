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
from the same org; the integration uses the server-to-server credential Demo Builder injects, the
screen uses the signed-in user's token from the Experience Cloud shell).

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

The one deploy-time input is `ERP_DISPLAY_NAME`, what the ERP calls itself (default "Acme ERP").
Demo Builder writes it from the name the SC enters; by hand, set it in the app's env file before
deploying. A redeploy with a new name renames the ERP unless someone renamed it on its screen.

The screen (`web-src/`) is React Spectrum and opens inside the Experience Cloud shell, which
supplies the sign-in. Demo Builder links to that shell URL.

## Licence

Apache-2.0. See `NOTICE` for the pieces adapted from elsewhere.
