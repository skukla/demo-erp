/*
 * The ERP's business events: what a real ERP publishes when something changes in it
 * (an IDoc, a change pointer, a queue entry). Each is journaled here, then delivered to
 * whoever subscribes. In this demo the subscriber is the Commerce integration's ingestion
 * webhook, which lives in the same App Builder workspace, so its address follows from the
 * ERP's own namespace and no address is configured: the ERP stays fully transient (wipe the
 * records and start again) and holds nothing that ties it to a particular Commerce instance.
 *
 * Event names follow the Commerce integration starter kit's back-office vocabulary.
 */
const { randomUUID } = require('crypto')
const { Core } = require('@adobe/aio-sdk')
const { findAll } = require('./db')

const DELIVER_TIMEOUT_MS = 5000
/** After this many failed deliveries an event is marked failed and left alone until someone requeues it. */
const MAX_ATTEMPTS = 10

/** The events, keyed by the ERP change that raises them. */
const EVENT_NAMES = {
  'product.price': 'be-observer.catalog_product_update',
  'product.stock': 'be-observer.catalog_stock_update',
  'order.cancelled': 'be-observer.sales_order_cancel',
  'order.confirmed': 'be-observer.sales_order_status_update',
  'order.invoiced': 'be-observer.sales_order_invoice_create',
  'order.shipped': 'be-observer.sales_order_shipment_create',
  'partner.blocked': 'be-observer.company_status_update',
  'partner.creditLimit': 'be-observer.company_credit_update'
}

/**
 * Where events go: the integration's ingestion webhook in this workspace, unless
 * `EVENTS_WEBHOOK_URL` says otherwise (tests, or an integration deployed elsewhere).
 *
 * @param {object} params the action params
 * @returns {string|null} the URL, or null when the namespace is unknown (local tests)
 */
function webhookUrl (params) {
  if (params && params.EVENTS_WEBHOOK_URL) return String(params.EVENTS_WEBHOOK_URL)
  const ns = process.env.__OW_NAMESPACE
  return ns ? `https://${ns}.adobeio-static.net/api/v1/web/ingestion/webhook` : null
}

/** @returns {Promise<object>} auth headers from the ERP's own workspace credential */
async function authHeaders (params) {
  if (!params.__ims_oauth_s2s) return { 'Content-Type': 'application/json' }
  const token = await Core.AuthClient.generateAccessToken(params)
  const s2s = typeof params.__ims_oauth_s2s === 'string' ? JSON.parse(params.__ims_oauth_s2s) : (params.__ims_oauth_s2s || {})
  const headers = { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }
  if (s2s.client_id) headers['x-api-key'] = s2s.client_id
  const org = s2s.ims_org_id || s2s.org_id || params.__ims_org_id
  if (org) headers['x-gw-ims-org-id'] = org
  return headers
}

/**
 * Post one journaled event to the webhook.
 *
 * @param {object} params the action params
 * @param {object} entry a journal entry
 * @param {object} [deps] `{ fetch }` for tests
 * @returns {Promise<{ delivered: boolean, status?: number, error?: string }>}
 */
async function deliver (params, entry, deps = {}) {
  const url = webhookUrl(params)
  if (!url) return { delivered: false, error: 'no webhook address (no namespace)' }
  const doFetch = deps.fetch || fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DELIVER_TIMEOUT_MS)
  try {
    const headers = deps.headers || await authHeaders(params)
    const res = await doFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ data: { uid: entry._id, event: entry.event, value: entry.value } }),
      signal: controller.signal
    })
    if (!res.ok) return { delivered: false, status: res.status, error: (await res.text()).slice(0, 200) }
    return { delivered: true, status: res.status }
  } catch (e) {
    return { delivered: false, error: e.message }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Journal an event and try to deliver it at once. A failed delivery stays pending for
 * the retry action; the caller's own write never fails because of it.
 *
 * @param {object} cols collections
 * @param {string} kind an EVENT_NAMES key
 * @param {object} value the event payload
 * @param {object} [params] action params (needed to deliver; tests omit it)
 * @returns {Promise<object>} the journal entry
 */
async function emit (cols, kind, value, params, deps) {
  const event = EVENT_NAMES[kind]
  if (!event) throw new Error(`unknown event kind ${kind}`)
  const entry = { _id: randomUUID(), at: new Date().toISOString(), kind, event, value, delivered: false, failed: false, attempts: 0 }
  await cols.events.replaceOne({ _id: entry._id }, entry, { upsert: true })
  if (params) await attempt(cols, entry, params, deps)
  return entry
}

async function attempt (cols, entry, params, deps) {
  const result = await deliver(params, entry, deps)
  const attempts = (entry.attempts || 0) + 1
  const next = {
    ...entry,
    attempts,
    lastAttemptAt: new Date().toISOString(),
    delivered: result.delivered,
    deliveredAt: result.delivered ? new Date().toISOString() : (entry.deliveredAt || null),
    failed: !result.delivered && attempts >= MAX_ATTEMPTS,
    lastError: result.delivered ? null : (result.error || `HTTP ${result.status}`)
  }
  await cols.events.replaceOne({ _id: entry._id }, next, { upsert: true })
  return next
}

/** Undelivered events still being retried, oldest first. (A missing `failed` flag counts as not failed.) */
async function pending (cols, limit = 200) {
  const undelivered = await findAll(cols.events, { delivered: false }, { limit, sort: { at: 1 } })
  return undelivered.filter((e) => !e.failed)
}

/** Events that used up their attempts. */
async function failed (cols, limit = 200) {
  const undelivered = await findAll(cols.events, { delivered: false }, { limit, sort: { at: 1 } })
  return undelivered.filter((e) => e.failed)
}

/** Put every failed event back in the queue with a fresh attempt count. */
async function requeueFailed (cols) {
  let count = 0
  for (const entry of await failed(cols)) {
    await cols.events.replaceOne({ _id: entry._id }, { ...entry, failed: false, attempts: 0, lastError: null }, { upsert: true })
    count += 1
  }
  return { requeued: count }
}

/** Newest events, for the screen. */
function recent (cols, limit = 100) {
  return findAll(cols.events, {}, { limit, sort: { at: -1 } })
}

/** Retry every undelivered event. @returns {Promise<{ delivered: number, pending: number }>} */
async function retryPending (cols, params, deps) {
  let delivered = 0
  let stillPending = 0
  for (const entry of await pending(cols)) {
    const next = await attempt(cols, entry, params, deps)
    if (next.delivered) delivered += 1
    else stillPending += 1
  }
  return { delivered, pending: stillPending }
}

module.exports = { EVENT_NAMES, MAX_ATTEMPTS, webhookUrl, authHeaders, deliver, emit, pending, failed, recent, retryPending, requeueFailed }
