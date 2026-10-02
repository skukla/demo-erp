/*
 * The user menu's Appearance panel: what a pick shows, and what Save sends
 * (screen/src/components/appearanceChoice.js, screen/src/api.js saveAppearance).
 *
 * The expected looks come from lib/appearance.js's own THEMES and DEFAULT_APPEARANCE, not
 * from the panel: the panel's preview has to be what the ERP will store.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { THEMES, DEFAULT_APPEARANCE, normalizeAppearance } = require('../lib/appearance')

const load = () => import('../screen/src/components/appearanceChoice.js')

const MERIDIAN = { palette: THEMES.meridian.palette, logo: THEMES.meridian.logo, nav: THEMES.meridian.nav }

test('nothing picked shows the saved look and sends nothing new', async () => {
  const { lookOf, NOTHING_PICKED } = await load()
  assert.deepEqual(lookOf(NOTHING_PICKED, MERIDIAN), MERIDIAN)
})

test('a theme brings its colour, mark and menu; a colour picked after it wins', async () => {
  const { lookOf, withTheme, withColor } = await load()
  const meridian = withTheme('meridian')
  assert.deepEqual(lookOf(meridian, DEFAULT_APPEARANCE), MERIDIAN)
  assert.deepEqual(lookOf(withColor(meridian, 'plum'), DEFAULT_APPEARANCE), { ...MERIDIAN, palette: 'plum' })
})

test('a theme picked after a colour sets the theme\'s colour', async () => {
  const { lookOf, withTheme } = await load()
  const choice = withTheme('granite')
  assert.equal(lookOf(choice, DEFAULT_APPEARANCE).palette, THEMES.granite.palette)
})

test('a colour alone keeps the saved mark and menu', async () => {
  const { lookOf, withColor, NOTHING_PICKED } = await load()
  assert.deepEqual(lookOf(withColor(NOTHING_PICKED, 'bronze'), MERIDIAN), { ...MERIDIAN, palette: 'bronze' })
})

test('what the panel shows is what the ERP stores from the same choice', async () => {
  const { lookOf, withTheme, withColor } = await load()
  const choice = withColor(withTheme('foundry'), 'teal')
  assert.deepEqual(lookOf(choice, MERIDIAN), normalizeAppearance(choice, MERIDIAN))
})

test('Save sends PATCH settings with { appearance: { theme, palette } }', async (t) => {
  const { makeApi } = await import('../screen/src/api.js')
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body), key: init.headers['x-erp-screen-key'] })
    return { ok: true, text: async () => '{}' }
  })
  await makeApi('k1', '/screen/').saveAppearance({ theme: 'harbour', palette: 'plum' })
  assert.deepEqual(calls, [{
    url: '/screen/api/settings',
    method: 'PATCH',
    body: { appearance: { theme: 'harbour', palette: 'plum' } },
    key: 'k1'
  }])
})
