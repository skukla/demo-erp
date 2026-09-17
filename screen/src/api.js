/*
 * Calls into the ERP through the `screen` action that served this page: the page
 * lives at `…/screen/`, its data at `…/screen/api/<action>/<path>`.
 */
/* global fetch, window */

/** The `screen` action's own address, always ending in a slash. */
export function screenBase (pathname = window.location.pathname) {
  return pathname.endsWith('/') ? pathname : `${pathname}/`
}

export function makeApi (screenKey, base = screenBase()) {
  async function call (action, { method = 'GET', path = '', body } = {}) {
    const headers = { 'Content-Type': 'application/json', 'x-erp-screen-key': screenKey || '' }
    const res = await fetch(`${base}api/${action}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    let data = {}
    try { data = text ? JSON.parse(text) : {} } catch (e) { data = { errorMessage: text } }
    if (!res.ok) {
      const error = new Error(data.errorMessage || data.error || `${action} answered ${res.status}`)
      error.status = res.status
      error.code = data.errorCode
      throw error
    }
    return data
  }
  return {
    health: () => call('health'),
    settings: () => call('settings'),
    saveSettings: (patch) => call('settings', { method: 'PATCH', body: patch }),
    wipe: () => call('admin', { method: 'POST', path: '/wipe' }),
    products: () => call('products'),
    product: (sku) => call('products', { path: `/${encodeURIComponent(sku)}` }),
    patchProduct: (sku, patch) => call('products', { method: 'PATCH', path: `/${encodeURIComponent(sku)}`, body: patch }),
    partners: () => call('partners'),
    patchPartner: (id, patch) => call('partners', { method: 'PATCH', path: `/${encodeURIComponent(id)}`, body: patch }),
    conditions: () => call('pricing'),
    saveCondition: (condition) => call('pricing', { method: 'POST', body: condition }),
    deleteCondition: (id) => call('pricing', { method: 'DELETE', path: `/${encodeURIComponent(id)}` }),
    quote: (body) => call('pricing', { method: 'POST', path: '/quote', body }),
    orders: () => call('orders'),
    order: (number) => call('orders', { path: `/${number}` }),
    moveOrder: (number, status) => call('orders', { method: 'POST', path: `/${number}/status`, body: { status } }),
    events: () => call('events'),
    retryEvents: () => call('events', { method: 'POST', path: '/retry' }),
    requeueEvents: () => call('events', { method: 'POST', path: '/requeue' }),
    sync: () => call('sync', { method: 'POST' })
  }
}
