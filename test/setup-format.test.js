/* The Settings page's words for the ERP's setup (screen/src/components/setupFormat.js). */
const { test } = require('node:test')
const assert = require('node:assert/strict')

const load = () => import('../screen/src/components/setupFormat.js')

test('an address reads as lines: street, then postal code and city with the region, then the country', async () => {
  const { addressLines } = await load()
  assert.deepEqual(addressLines({ street: ['1 Harbor Way', 'Suite 2'], city: 'Seattle', region: 'WA', postcode: '98101', countryId: 'US' }), ['1 Harbor Way', 'Suite 2', '98101 Seattle, WA', 'US'])
  assert.deepEqual(addressLines({ street: [], city: null, region: null, postcode: null, countryId: 'DE' }), ['DE'])
  assert.deepEqual(addressLines(null), [])
})

test('payment terms offered keep the ones in force, and read with their days', async () => {
  const { paymentTermsOptions, paymentTermsText } = await load()
  assert.ok(paymentTermsOptions('NET30').some((o) => o.id === 'NET30'))
  assert.deepEqual(paymentTermsOptions('NET21').at(-1), { id: 'NET21', name: 'NET21 · 21 days' })
  assert.equal(paymentTermsText('NET45'), 'NET45 · 45 days')
})

test('every credit warnings value the ERP accepts has its Business Central label', async () => {
  const { CREDIT_WARNING_OPTIONS, creditWarningText } = await load()
  const { CREDIT_WARNINGS } = require('../lib/credit')
  assert.deepEqual(CREDIT_WARNING_OPTIONS.map((o) => o.id), CREDIT_WARNINGS)
  assert.equal(creditWarningText('overdue'), 'Overdue balance')
})

test('every number series the ERP keeps has a name on the page', async () => {
  const { seriesText } = await load()
  const { STARTS } = require('../lib/counters')
  for (const type of Object.keys(STARTS)) assert.notEqual(seriesText(type), type, type)
})
