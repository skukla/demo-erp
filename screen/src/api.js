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
    // The ERP's setup (Settings): its four sections, and its own sales organizations.
    setup: () => call('settings', { path: '/setup' }),
    saveSetup: (patch) => call('settings', { method: 'PATCH', path: '/setup', body: patch }),
    addSalesOrganization: (org) => call('settings', { method: 'POST', path: '/sales-organizations', body: org }),
    updateSalesOrganization: (code, patch) => call('settings', { method: 'PATCH', path: `/sales-organizations/${encodeURIComponent(code)}`, body: patch }),
    // A warehouse is a plant, under the ERP's own name for it; its name is stored
    // with the settings, but the SC manages warehouses on their own Master Data screen.
    renameWarehouse: (code, name) => call('settings', { method: 'PATCH', body: { warehouses: { [code]: { name } } } }),
    // How the screen looks, from the user menu: `{ theme?, palette? }` (lib/appearance.js).
    saveAppearance: (appearance) => call('settings', { method: 'PATCH', body: { appearance } }),
    products: () => call('products'),
    product: (sku) => call('products', { path: `/${encodeURIComponent(sku)}` }),
    patchProduct: (sku, patch) => call('products', { method: 'PATCH', path: `/${encodeURIComponent(sku)}`, body: patch }),
    partners: () => call('partners'),
    partner: (id) => call('partners', { path: `/${encodeURIComponent(id)}` }),
    patchPartner: (id, patch) => call('partners', { method: 'PATCH', path: `/${encodeURIComponent(id)}`, body: patch }),
    conditions: () => call('pricing'),
    saveCondition: (condition) => call('pricing', { method: 'POST', body: condition }),
    deleteCondition: (id) => call('pricing', { method: 'DELETE', path: `/${encodeURIComponent(id)}` }),
    quote: (body) => call('pricing', { method: 'POST', path: '/quote', body }),
    contracts: () => call('contracts'),
    contract: (number) => call('contracts', { path: `/${number}` }),
    createContract: (body) => call('contracts', { method: 'POST', body }),
    updateContract: (number, patch) => call('contracts', { method: 'PATCH', path: `/${number}`, body: patch }),
    activateContract: (number) => call('contracts', { method: 'POST', path: `/${number}/activate` }),
    deactivateContract: (number) => call('contracts', { method: 'POST', path: `/${number}/deactivate` }),
    priceGroups: () => call('contracts', { path: '/price-groups' }),
    savePriceGroup: (group) => call('contracts', { method: 'POST', path: '/price-groups', body: group }),
    deletePriceGroup: (code) => call('contracts', { method: 'DELETE', path: `/price-groups/${encodeURIComponent(code)}` }),
    orders: () => call('orders'),
    order: (number) => call('orders', { path: `/${number}` }),
    confirmOrder: (number) => call('orders', { method: 'POST', path: `/${number}/confirm` }),
    cancelOrder: (number, reason) => call('orders', { method: 'POST', path: `/${number}/cancel`, body: { reason } }),
    createShipment: (number, body) => call('orders', { method: 'POST', path: `/${number}/shipments`, body }),
    postShipment: (number, shipment) => call('orders', { method: 'POST', path: `/${number}/shipments/${shipment}/post` }),
    closeLine: (number, item, reason) => call('orders', { method: 'POST', path: `/${number}/lines/${item}/close`, body: { reason } }),
    createInvoice: (number) => call('orders', { method: 'POST', path: `/${number}/invoice` }),
    releaseCredit: (number) => call('orders', { method: 'POST', path: `/${number}/credit/release` }),
    rejectCredit: (number) => call('orders', { method: 'POST', path: `/${number}/credit/reject` }),
    shipments: () => call('shipments'),
    shipment: (number) => call('shipments', { path: `/${number}` }),
    invoices: () => call('invoices'),
    invoice: (number) => call('invoices', { path: `/${number}` }),
    // Crediting the whole invoice is a move on its order (POST orders/:number/credit-memo).
    creditInvoice: (orderNumber) => call('orders', { method: 'POST', path: `/${orderNumber}/credit-memo` }),
    returns: () => call('returns'),
    returnOrder: (number) => call('returns', { path: `/${number}` }),
    receiveReturn: (number) => call('returns', { method: 'POST', path: `/${number}/receive` }),
    creditReturn: (number) => call('returns', { method: 'POST', path: `/${number}/credit-memo` }),
    creditMemos: () => call('credit-memos'),
    creditMemo: (number) => call('credit-memos', { path: `/${number}` }),
    // An incoming payment is posted on its invoice (contract version 14); the payment is a document of its own.
    postPayment: (invoiceNumber, body) => call('invoices', { method: 'POST', path: `/${invoiceNumber}/payments`, body }),
    payments: () => call('payments'),
    payment: (number) => call('payments', { path: `/${number}` }),
    search: (q) => call('search', { path: `?q=${encodeURIComponent(q)}` }),
    events: () => call('events'),
    retryEvents: () => call('events', { method: 'POST', path: '/retry' }),
    requeueEvents: () => call('events', { method: 'POST', path: '/requeue' })
  }
}
