/*
 * The shell bar's search: one box that opens any document — a sales order, shipment or
 * invoice by number, a product by SKU or name, a customer by id or name — from anywhere.
 * Fiori has it as the shell's search, Business Central as "Tell me"; ours had a search
 * per grid only, which meant knowing which list a thing was in before finding it.
 *
 * The ERP answers as you type (actions/search), best match first; choosing a result
 * opens the document on its own list page, so Back from it lands on that list.
 *
 * Two Spectrum ComboBox facts shape this file (read in its source, 2026-09-24):
 * - it opens its list only on an input change that finds a non-empty collection, or in
 *   async mode (`loadingState` given) with any collection — a controlled `isOpen` prop is
 *   ignored (`useComboBoxState` passes `isOpen: undefined`). So the list is kept
 *   non-empty from the first keystroke with a "Searching…" row the ERP's answer replaces;
 * - its own loading circle, once shown after 500 ms, never clears (`prevIsLoading` is
 *   only updated while not loading), so `loadingState` stays 'idle' and the row above
 *   is the only loading indicator.
 */
import React, { useEffect, useRef, useState } from 'react'
import { ComboBox, Item, Text } from '@adobe/react-spectrum'
import { LIST_OF } from './Home'

/** Typing pauses this long before the ERP is asked, so a number typed in one go is asked once. */
const ASK_AFTER_MS = 250
const SEARCHING = { id: 'searching', title: 'Searching…', placeholder: true }
const NOTHING = { id: 'nothing', title: 'Nothing matches', placeholder: true }
const PLACEHOLDERS = [SEARCHING.id, NOTHING.id]

export default function ShellSearch ({ api, onOpen }) {
  const [text, setText] = useState('')
  const [items, setItems] = useState([])
  const timer = useRef(null)
  const asked = useRef('')

  useEffect(() => {
    clearTimeout(timer.current)
    const q = text.trim()
    if (q.length < 2) { setItems([]); return undefined }
    setItems([SEARCHING])
    timer.current = setTimeout(async () => {
      asked.current = q
      try {
        const answer = await api.search(q)
        // A slower answer to an older question must not replace the newer one.
        if (asked.current !== q) return
        const found = (answer.items || []).map((r) => ({ ...r, id: `${r.kind}:${r.number}` }))
        setItems(found.length > 0 ? found : [NOTHING])
      } catch (e) {
        if (asked.current === q) setItems([NOTHING])
      }
    }, ASK_AFTER_MS)
    return () => clearTimeout(timer.current)
  }, [text, api])

  return (
    <div className='erp-shell-search'>
      <ComboBox
        aria-label='Search the ERP'
        placeholder='Search orders, products, customers'
        items={items}
        disabledKeys={PLACEHOLDERS}
        inputValue={text}
        onInputChange={setText}
        selectedKey={null}
        onSelectionChange={(key) => {
          const hit = items.find((i) => i.id === key)
          if (!hit || hit.placeholder) return
          setText('')
          setItems([])
          onOpen(LIST_OF[hit.kind], { open: hit.number })
        }}
        allowsCustomValue
        menuTrigger='input'
        loadingState='idle'
        width='100%'
      >
        {(item) => (
          <Item key={item.id} textValue={item.title}>
            <Text>{item.title}</Text>
            {item.subtitle && <Text slot='description'>{item.subtitle}</Text>}
          </Item>
        )}
      </ComboBox>
    </div>
  )
}
