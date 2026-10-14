/*
 * How a grid's search and sort reach Spectrum. The rules themselves are in
 * ../gridView.js, where they are tested without React.
 *
 * A grid passes a description of itself — which fields the search reads, and which
 * accessor each sortable column uses. Declare it as a module constant, not inline:
 * an object literal is a new reference every render, and the memo below would be
 * rebuilt each time.
 */
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Flex, SearchField, Text } from '@adobe/react-spectrum'
import { applyView } from '../gridView'

/**
 * @param {object[]|null} rows every record the grid holds, or null while loading
 * @param {object} grid `{ fields, values, sort? }` — see ../gridView.js
 * @returns {object} `items` to render, `searchProps` for GridSearch, `tableProps`
 *   for the TableView, and the shown/total counts
 */
export function useGridView (rows, grid) {
  const [text, setText] = useState('')
  const [sort, setSort] = useState(grid.sort || {})
  const items = useMemo(
    () => applyView(rows, { fields: grid.fields, values: grid.values, text, sort }),
    [rows, grid, text, sort]
  )
  return {
    items,
    shown: items.length,
    total: (rows || []).length,
    searchProps: { value: text, onChange: setText },
    // Spectrum wants no descriptor at all until a column has been chosen.
    tableProps: { sortDescriptor: sort.column ? sort : undefined, onSortChange: setSort }
  }
}

/**
 * The width a search field needs to show its whole placeholder: the text, measured in
 * the input's own font, plus whatever the field spends around it (the search icon,
 * the clear button, padding). Measured once the field is on screen.
 *
 * @param {string} placeholder the text to fit
 * @returns {{ ref: object, style: object|undefined }} for the field's wrapper
 */
function usePlaceholderFit (placeholder) {
  const ref = useRef(null)
  const [width, setWidth] = useState()
  useLayoutEffect(() => {
    const input = ref.current?.querySelector('input')
    if (!input) return
    const css = getComputedStyle(input)
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return
    context.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`
    const text = context.measureText(placeholder).width
    const room = input.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)
    const around = ref.current.offsetWidth - room
    // A few pixels over the measure: italics lean past their advance width.
    setWidth(Math.ceil(text + around + 4))
  }, [placeholder])
  return { ref, style: width ? { minWidth: width } : undefined }
}

/**
 * The line above a grid: the search box, anything else the page puts beside it, and
 * how many rows the search left — shown only while it is hiding some, so a grid
 * nobody has searched carries no count to read past.
 */
export function GridSearch ({ placeholder, view, children }) {
  const fit = usePlaceholderFit(placeholder)
  return (
    <Flex alignItems='end' gap='size-200' marginTop='size-200' wrap>
      {/* The field is as wide as its placeholder needs, measured in the browser's own
          font (`usePlaceholderFit`), and no narrower than the base width in app.css.
          A fixed width cut long placeholders off ("Shipment, order, customer or
          wareho…", 2026-10-13), and shrinking beside the Pickers cut more. */}
      <div className='erp-search' ref={fit.ref} style={fit.style}>
        <SearchField label='Search' placeholder={placeholder} width='100%' {...view.searchProps} />
      </div>
      {children}
      {view.shown !== view.total && (
        <Text marginBottom='size-100'>{view.shown} of {view.total}</Text>
      )}
    </Flex>
  )
}
