/*
 * Settings → Company (AB-59): the ERP's own company information, as Business Central's
 * Company Information page holds it: name, address, tax ID, currency and company code. Each
 * field changes what the ERP prints: the seller block on every invoice, the company code the
 * structure answers, and the currency money with no currency of its own is shown in.
 * Until a field is set, what the last fill sent stands in for it (the home website's
 * Store Information), so an ERP set up before this page existed reads as it did.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { importProducts } = require('../lib/products')
const { createOrder } = require('../lib/orders')
const { confirmOrder, createShipment, postShipment, createInvoice, getInvoice } = require('../lib/fulfilment')
const settings = require('../actions/settings')
const health = require('../actions/health')
const admin = require('../actions/admin')

const STRUCTURE = { websites: [
  { code: 'base', name: 'Main Website', salesOrg: '1000', salesOrgName: 'Online US', storeInfo: { currency: 'USD', countryId: 'US', vatNumber: null, address: null } }
] }
const PARAMS = { ERP_DISPLAY_NAME: 'Northwind ERP' }

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [{ sku: 'A1', name: 'Trouser', listPrice: 100, warehouses: [{ code: 'default', name: 'Default Source', quantity: 5 }] }])
  await invoke(admin, cols, { method: 'POST', path: '/import', body: { structure: STRUCTURE, partners: [{ id: 'C7', name: 'Acme' }] } })
})

async function anInvoice () {
  const order = await createOrder(cols, { commerceOrderId: '1', partnerId: 'C7', salesOrg: '1000', lines: [{ sku: 'A1', qty: 1, price: 100, commerceItemId: 1 }] })
  await confirmOrder(cols, order.number)
  const shipped = await createShipment(cols, order.number, { lines: [{ item: 10, qty: 1 }] })
  await postShipment(cols, order.number, shipped.shipments[0].number)
  const invoiced = await createInvoice(cols, order.number)
  return getInvoice(cols, invoiced.invoice.number)
}

const patch = (body) => invoke(settings, cols, { method: 'PATCH', path: '/setup', body, params: PARAMS })

test('before anything is set, the company reads from the ERP name and the fill', async () => {
  const res = await invoke(settings, cols, { path: '/setup', params: PARAMS })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body.company, { code: '1000', name: 'Northwind ERP', address: null, taxId: null, currency: 'USD' })
})

test('the company set on Settings is the seller on the invoice', async () => {
  const address = { street: ['1 Harbor Way'], city: 'Seattle', region: 'WA', postcode: '98101', countryId: 'US' }
  const res = await patch({ company: { name: 'Northwind Traders Inc.', code: 'nw01', taxId: 'US 91-1234567', currency: 'cad', address } })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body.company, { code: 'NW01', name: 'Northwind Traders Inc.', address, taxId: 'US 91-1234567', currency: 'CAD' })
  const invoice = await anInvoice()
  assert.equal(invoice.seller.companyCode, 'NW01')
  assert.equal(invoice.seller.name, 'Northwind Traders Inc.')
  assert.equal(invoice.seller.vatNumber, 'US 91-1234567')
  assert.deepEqual(invoice.seller.address, address)
})

test('the company code and currency are what health answers, so the screen shows money in it', async () => {
  await patch({ company: { code: '2100', currency: 'EUR' } })
  const res = await invoke(health, cols, { params: PARAMS })
  assert.equal(res.body.structure.companyCode.code, '2100')
  assert.equal(res.body.structure.companyCode.currency, 'EUR')
  assert.equal(res.body.currency, 'EUR')
})

test('a field cleared falls back to what the fill sent; the ERP name is still its own', async () => {
  await patch({ company: { taxId: 'X1' } })
  const cleared = await patch({ company: { taxId: '' } })
  assert.equal(cleared.body.company.taxId, null)
  const res = await invoke(health, cols, { params: PARAMS })
  assert.equal(res.body.displayName, 'Northwind ERP', 'the shell bar keeps the name the ERP was added with')
})

test('a company that cannot be is refused in words, and nothing of the patch is kept', async () => {
  const refusals = [
    [{ company: { code: '12345' } }, 'A company code is 1 to 4 letters or digits, such as 1000.'],
    [{ company: { name: '  ' } }, 'The company needs a name.'],
    [{ company: { currency: 'dollars' } }, 'A currency is a three-letter code, such as USD.'],
    [{ company: { address: { countryId: 'USA' } } }, 'A country is a two-letter code, such as US.'],
    [{ company: { name: 'Kept?', currency: 'XX' } }, 'A currency is a three-letter code, such as USD.']
  ]
  for (const [body, message] of refusals) {
    const res = await patch(body)
    assert.equal(res.statusCode, 400, JSON.stringify(body))
    assert.equal(res.body.errorMessage, message)
  }
  const after = await invoke(settings, cols, { path: '/setup', params: PARAMS })
  assert.equal(after.body.company.name, 'Northwind ERP', 'the refused patch left the name alone')
})
