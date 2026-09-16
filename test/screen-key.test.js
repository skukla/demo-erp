/* The page's key handling, against a stand-in window. */
const { test } = require('node:test')
const assert = require('node:assert/strict')

async function load () {
  return import('../screen/src/key.js')
}

function fakeWindow (href, stored = {}) {
  const store = { ...stored }
  const win = {
    location: { href },
    sessionStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v } },
    history: { replaceState: (_s, _t, url) => { win.replaced = url } }
  }
  return { win, store }
}

test('takes the key from the link, keeps it, and removes it from the address', async () => {
  const { takeScreenKey } = await load()
  const { win, store } = fakeWindow('https://ns.example/api/v1/web/demo-erp/screen/?key=abc&x=1#top')
  assert.equal(takeScreenKey(win), 'abc')
  assert.equal(store['demo-erp.screenKey'], 'abc')
  assert.equal(win.replaced, '/api/v1/web/demo-erp/screen/?x=1#top')
})

test('falls back to the kept key after a reload', async () => {
  const { takeScreenKey } = await load()
  const { win } = fakeWindow('https://ns.example/screen/', { 'demo-erp.screenKey': 'kept' })
  assert.equal(takeScreenKey(win), 'kept')
  assert.equal(win.replaced, undefined)
})

test('answers null when there is no key anywhere', async () => {
  const { takeScreenKey } = await load()
  assert.equal(takeScreenKey(fakeWindow('https://ns.example/screen/').win), null)
})
