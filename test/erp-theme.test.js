/*
 * A second ERP starts with a look of its own (AB-16c). Each ERP is told its id in the
 * integration's list at deploy (ERP_ID: the ERP's name slugged — `northwind`, `contoso` —
 * since 2026-09-30; before that `erp` for the first and `demo-erp-2` for the next), and a
 * fresh ERP takes its starting theme from that id, so two ERPs side by side on a projector
 * are told apart at a glance. Only a fresh ERP: an ERP whose look is already stored keeps
 * it, because the SC may have picked it.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections } = require('./helpers/memory-db')
const { getSettings, updateSettings } = require('../lib/settings')
const { THEMES, DEFAULT_APPEARANCE, themeForErpId } = require('../lib/appearance')

const look = (id) => ({ palette: THEMES[id].palette, logo: THEMES[id].logo, nav: THEMES[id].nav })

let cols
beforeEach(() => { cols = memoryCollections() })

test('an ERP told no id starts with the default look', () => {
  assert.equal(themeForErpId(undefined), undefined)
  assert.equal(themeForErpId(''), undefined)
})

test('a named ERP takes a theme from its name, the same one every time', () => {
  const ids = Object.keys(THEMES)
  for (const id of ['northwind', 'contoso', 'justrite', 'accuform', 'erp']) {
    assert.ok(ids.includes(themeForErpId(id)), `${id} lands on a theme`)
    assert.equal(themeForErpId(id), themeForErpId(id))
  }
  // The two mock ERPs a demo puts side by side are told apart at a glance. With four
  // themes some pair of names will share one; that pair is not this one.
  assert.notEqual(themeForErpId('northwind'), themeForErpId('contoso'))
})

test('an added ERP takes the next theme by its number, round the list', () => {
  const ids = Object.keys(THEMES)
  assert.equal(themeForErpId('demo-erp-2'), ids[1])
  assert.equal(themeForErpId('demo-erp-3'), ids[2])
  assert.equal(themeForErpId('demo-erp-4'), ids[3])
  assert.equal(themeForErpId('demo-erp-5'), ids[0])
})

test('a fresh ERP stores the look its id gives it', async () => {
  const settings = await getSettings(cols, 'Contoso ERP', 'demo-erp-2')
  assert.deepEqual(settings.appearance, look(Object.keys(THEMES)[1]))
})

test('a fresh ERP told no id stores the default look', async () => {
  const settings = await getSettings(cols, 'Northwind ERP')
  assert.deepEqual(settings.appearance, DEFAULT_APPEARANCE)
})

test('an ERP whose look is stored keeps it, whatever id it is told', async () => {
  await getSettings(cols, 'Contoso ERP')
  await updateSettings(cols, { appearance: { theme: 'foundry' } })
  const settings = await getSettings(cols, 'Contoso ERP', 'demo-erp-2')
  assert.deepEqual(settings.appearance, look('foundry'))
})
