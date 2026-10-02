/*
 * The ERP's business events: what a real ERP publishes when something changes in it
 * (SAP's business events, Business Central's webhooks). Each is journaled here, then
 * delivered to whoever subscribes. In this demo the subscriber is a web shop integration's
 * ingestion webhook. An ERP in the same App Builder workspace finds it from its own namespace
 * and signs with its own credential; an ERP in a workspace of its own is deployed with the
 * address and a publishing credential the integration's workspace issued (EVENTS_WEBHOOK_URL,
 * EVENTS_AUTH_*). Either way the ERP stays fully transient (wipe the records and start again)
 * and holds nothing that ties it to a particular subscriber.
 *
 * Contract version 16: each event is a CloudEvents 1.0 envelope (`specversion, id, source,
 * type, time, datacontenttype, data`), as SAP sends its own. The type is object + action in the
 * ERP's words (SalesOrder.Changed, BillingDocument.Created, …) and `data` is the ERP's record
 * in its own words: what the subscriber calls things is the subscriber's to translate.
 */
const { randomUUID } = require('crypto')
const { Core } = require('@adobe/aio-sdk')
const { findAll } = require('./db')
const { withCurrent } = require('./spelling')
const { reasonNow } = require('./legacy')

const DELIVER_TIMEOUT_MS = 5000
/** After this many failed deliveries an event is marked failed and left alone until someone requeues it. */
const MAX_ATTEMPTS = 10

/** The event types the ERP raises (contract `events.types`). */
const EVENT_TYPES = [
  // Confirmed, canceled, put on credit hold or released.
  'SalesOrder.Changed',
  // A shipment posted: the goods left the plant.
  'OutboundDelivery.GoodsIssueStatusChanged',
  // An invoice, or a credit memo (BillingDocumentType Invoice | CreditMemo).
  'BillingDocument.Created',
  // A return order's goods received.
  'CustomerReturn.Changed',
  // An incoming payment posted against one invoice.
  'IncomingPayment.Posted',
  // A product's name, list price or sales status edited; ChangedFields says which.
  'Product.Changed',
  // One product's quantity in one plant.
  'ProductStock.Changed',
  // A customer's credit limit or blocking level; ChangedFields says which.
  'Customer.Changed',
  // A customer's prices in force, the whole set each time (lib/contracts).
  'PriceList.Changed'
]

/** The CloudEvents spec version and data content type every envelope carries. */
const SPEC_VERSION = '1.0'
const DATA_CONTENT_TYPE = 'application/json'

/**
 * A deploy-time input's value, or undefined when it was left unset: an unset input can
 * reach the action as '' or as the literal '$NAME'.
 *
 * @param {object} params the action params
 * @param {string} name the input's name
 * @returns {string|undefined} the value
 */
function input (params, name) {
  const value = params && params[name]
  if (typeof value !== 'string' || !value.trim() || value === `$${name}`) return undefined
  return value
}

/**
 * Where events go: the integration's ingestion webhook in this workspace, unless
 * `EVENTS_WEBHOOK_URL` says otherwise (tests, or an integration in another workspace).
 *
 * @param {object} params the action params
 * @returns {string|null} the URL, or null when the namespace is unknown (local tests)
 */
function webhookUrl (params) {
  const configured = input(params, 'EVENTS_WEBHOOK_URL')
  if (configured) return configured
  const ns = process.env.__OW_NAMESPACE
  return ns ? `https://${ns}.adobeio-static.net/api/v1/web/ingestion/webhook` : null
}

/**
 * The publishing credential the integration issued this ERP, when it was deployed with one
 * (EVENTS_AUTH_*): an ERP in a workspace of its own posts to an integration whose ingestion
 * accepts only the integration's own technical account. Scopes are a JSON array string.
 *
 * @param {object} params the action params
 * @returns {object|undefined} `{ clientId, clientSecret, orgId, scopes }`, or undefined
 */
function publishingCredential (params) {
  const clientId = input(params, 'EVENTS_AUTH_CLIENT_ID')
  const clientSecret = input(params, 'EVENTS_AUTH_CLIENT_SECRET')
  const orgId = input(params, 'EVENTS_AUTH_ORG_ID')
  if (!clientId || !clientSecret || !orgId) return undefined
  return { clientId, clientSecret, orgId, scopes: scopesOf(input(params, 'EVENTS_AUTH_SCOPES')) }
}

function scopesOf (text) {
  try {
    const scopes = JSON.parse(text || '[]')
    return Array.isArray(scopes) ? scopes.map(String) : []
  } catch (e) {
    return []
  }
}

/**
 * Auth headers for an event post: the publishing credential when the ERP was given one,
 * else the ERP's own workspace credential. Tokens are cached by the auth library, keyed by
 * the client id (with its org, scopes and secret), so each credential mints once per
 * token lifetime.
 *
 * @param {object} params the action params
 * @param {object} [deps] `{ generateAccessToken }` for tests
 * @returns {Promise<object>} the headers
 */
async function authHeaders (params, deps = {}) {
  const mint = deps.generateAccessToken || Core.AuthClient.generateAccessToken
  const publishing = publishingCredential(params)
  if (publishing) {
    const token = await mint(publishing, params.__ims_env)
    return {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
      'x-api-key': publishing.clientId,
      'x-gw-ims-org-id': publishing.orgId
    }
  }
  if (!params.__ims_oauth_s2s) return { 'Content-Type': 'application/json' }
  const token = await mint(params)
  const s2s = typeof params.__ims_oauth_s2s === 'string' ? JSON.parse(params.__ims_oauth_s2s) : (params.__ims_oauth_s2s || {})
  const headers = { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }
  if (s2s.client_id) headers['x-api-key'] = s2s.client_id
  const org = s2s.ims_org_id || s2s.org_id || params.__ims_org_id
  if (org) headers['x-gw-ims-org-id'] = org
  return headers
}

const ERP_ID = /^[a-z][a-z0-9-]{0,62}$/

/**
 * Who is speaking: `/erp/<ERP_ID>` when the ERP was deployed with an id (the id the
 * integration's ERP list gives it; contract version 4), so a subscriber serving several ERPs
 * knows which one spoke; `/erp` without one (the single ERP).
 */
function sourceOf (params) {
  // An unset ERP_ID can reach the action as '' or as the literal '$ERP_ID': neither is an id.
  const id = params && typeof params.ERP_ID === 'string' ? params.ERP_ID : ''
  return ERP_ID.test(id) ? `/erp/${id}` : '/erp'
}

/**
 * One journaled event as delivered: a CloudEvents 1.0 envelope. Its id is the journal
 * entry's, so a redelivery carries the same id and a subscriber can tell it is the same event.
 *
 * @param {object} entry an outbound journal entry
 * @param {object} [params] the action params (for ERP_ID)
 * @returns {object} the envelope
 */
function envelope (entry, params) {
  return {
    specversion: SPEC_VERSION,
    id: entry._id,
    source: sourceOf(params),
    type: entry.type,
    time: entry.at,
    datacontenttype: DATA_CONTENT_TYPE,
    data: entry.data
  }
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
    const headers = deps.headers || await authHeaders(params, deps)
    const res = await doFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(envelope(entry, params)),
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
 * @param {string} type one of EVENT_TYPES
 * @param {object} data the event's data, in the ERP's words
 * @param {object} [params] action params (needed to deliver; tests omit it)
 * @returns {Promise<object>} the journal entry
 */
async function emit (cols, type, data, params, deps) {
  if (!EVENT_TYPES.includes(type)) throw new Error(`unknown event type ${type}`)
  const entry = { _id: randomUUID(), at: new Date().toISOString(), direction: 'out', type, data, delivered: false, failed: false, attempts: 0 }
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

/**
 * Journal a change that arrived FROM another system, so the log shows both directions.
 *
 * Only outbound entries were journaled until 2026-09-18, so a change a web shop sent
 * — a renamed product, a new order — left no trace on the screen an SC checks; a
 * working integration and a broken one looked the same. An inbound entry carries no
 * `delivered` flag, so the retry queue (`pending`, `failed`) never sees it.
 *
 * @param {object} cols collections
 * @param {{ system: string, document?: string, eventId?: string }} origin who sent it and
 *   which of its documents it was (contract version 16; lib/inbound originOf)
 * @param {string} summary what the ERP did with it, in words
 * @param {object} [value] the ids involved
 * @returns {Promise<object>} the journal entry
 */
async function receive (cols, origin, summary, value = {}) {
  const { eventId, ...from } = origin
  const entry = { _id: randomUUID(), at: new Date().toISOString(), direction: 'in', origin: from, summary, value, ...(eventId ? { eventId } : {}) }
  await cols.events.replaceOne({ _id: entry._id }, entry, { upsert: true })
  return entry
}

/**
 * A journal entry in today's words. An outbound entry journaled before contract version 16
 * carries a `kind` and the payload it was sent with (`value`) rather than a type and data; it
 * reads as it was (lib/journal names it), and is never delivered again: no subscriber of
 * version 16 reads that payload. An entry stored before version 10 names its kind
 * order.cancelled and carries status cancelled (lib/spelling); a reason that named the web
 * shop reads in today's words (lib/legacy).
 */
function upgradeEntry (stored) {
  const entry = withCurrent(stored, ['kind'])
  const value = stored.value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const words = withCurrent(value, ['status', 'reason'])
    entry.value = Object.prototype.hasOwnProperty.call(words, 'reason') ? { ...words, reason: reasonNow(words.reason) } : words
  }
  return entry
}

/** An outbound entry a version 16 subscriber can be sent: one with a type. */
const deliverable = (entry) => typeof entry.type === 'string' && EVENT_TYPES.includes(entry.type)

/** Journal entries matching the filter, upgraded. */
async function readEntries (cols, filter, options) {
  return (await findAll(cols.events, filter, options)).map(upgradeEntry)
}

/** Undelivered events still being retried, oldest first. (A missing `failed` flag counts as not failed.) */
async function pending (cols, limit = 200) {
  const undelivered = await readEntries(cols, { delivered: false }, { limit, sort: { at: 1 } })
  return undelivered.filter((e) => !e.failed && deliverable(e))
}

/** Events that used up their attempts. */
async function failed (cols, limit = 200) {
  const undelivered = await readEntries(cols, { delivered: false }, { limit, sort: { at: 1 } })
  return undelivered.filter((e) => e.failed && deliverable(e))
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
  return readEntries(cols, {}, { limit, sort: { at: -1 } })
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

module.exports = { EVENT_TYPES, MAX_ATTEMPTS, webhookUrl, authHeaders, sourceOf, envelope, deliver, emit, receive, pending, failed, recent, retryPending, requeueFailed }
