# demo-erp

A mock ERP, modelled on SAP, that runs as an Adobe App Builder app. It is a Demo Builder
**system** component: it ships with the Commerce ERP integration
([skukla/commerce-erp-integration](https://github.com/skukla/commerce-erp-integration)),
is installed and removed with it, and knows nothing about Commerce itself.

What it holds, in SAP's words:

| Collection | What it is | Who owns the values |
|---|---|---|
| Materials | products: SKU, description, plant, **list price**, **stock** | mirrored in from the integration, then edited here |
| Business partners | accounts (sold-to): name, sales org, payment terms, **credit limit**, credit used, **blocked** | mirrored in, then edited here; one default partner for walk-in customers |
| Pricing conditions | contract prices, contract discounts, max-discount ceilings | created here |
| Sales orders | created by the integration from Commerce orders; **status** moved here (created → confirmed → shipped → invoiced, or cancelled) | number is the ERP's, never reused |
| Outbox | every change Commerce should hear about (price, stock, credit limit, block, order status); the integration drains and acknowledges it | |
| Settings | display name, **offline** switch (every record request answers 503, the way an outage looks) | |

Records are transitory. `POST admin/wipe` removes everything except the settings and the
order-number counter; the integration then re-imports from Commerce. The counter never
rewinds, so an order number a Commerce order carries from before a reset cannot collide.

## API

Web actions under one runtime package, all `require-adobe-auth` (a caller presents an IMS token
from the same org; the integration uses the server-to-server credential Demo Builder injects, the
screen uses the signed-in user's token from the Experience Cloud shell).

| Action | Routes |
|---|---|
| `health` | `GET` name, offline, counts, last import/wipe |
| `settings` | `GET`, `PATCH { displayName?, offline? }` |
| `admin` | `POST /wipe`, `POST /import { materials[], partners[], projectName? }` |
| `materials` | `GET`, `GET /:sku`, `PATCH /:sku { listPrice?, stock? }` |
| `partners` | `GET`, `GET /:id`, `PATCH /:id { creditLimit?, blocked?, paymentTerms? }` (import rows may carry `emailDomain`; quotes resolve the partner by id, company, email domain, then customer group) |
| `pricing` | `GET` conditions, `POST` a condition, `DELETE /:id`, `POST /quote { partnerId? \| commerceCompanyId? \| customerGroupId?, lines:[{sku, qty}] }` |
| `orders` | `GET`, `GET /:number`, `POST { commerceOrderId, commerceIncrementId?, partnerId?, lines, currency?, total? }` (idempotent), `POST /:number/status { status }` |
| `outbox` | `GET` pending, `POST /ack { ids[] }` |

Errors are `{ status: 'ERROR', errorCode, errorMessage }` with a 400/404/503/500.

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
