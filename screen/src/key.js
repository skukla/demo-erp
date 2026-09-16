/*
 * The screen's one credential: the key Demo Builder puts in the link it opens.
 * Read from `?key=` once, kept for the tab's lifetime, and taken out of the
 * address bar so a copied URL does not carry it onward.
 */
/* global window */
const STORAGE_KEY = 'demo-erp.screenKey'

export function takeScreenKey (win = window) {
  const url = new URL(win.location.href)
  const fromLink = url.searchParams.get('key')
  if (fromLink) {
    try { win.sessionStorage.setItem(STORAGE_KEY, fromLink) } catch (e) { /* storage blocked: the key lives for this page only */ }
    url.searchParams.delete('key')
    win.history.replaceState(null, '', url.pathname + url.search + url.hash)
    return fromLink
  }
  try { return win.sessionStorage.getItem(STORAGE_KEY) } catch (e) { return null }
}
