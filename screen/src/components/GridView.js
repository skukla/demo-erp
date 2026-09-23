/*
 * How a grid's search and sort reach Spectrum. The rules themselves are in
 * ../gridView.js, where they are tested without React.
 *
 * A grid passes a description of itself — which fields the search reads, and which
 * accessor each sortable column uses. Declare it as a module constant, not inline:
 * an object literal is a new reference every render, and the memo below would be
 * rebuilt each time.
 */
import React, { useMemo, useState } from 'react'
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
 * The line above a grid: the search box, anything else the page puts beside it, and
 * how many rows the search left — shown only while it is hiding some, so a grid
 * nobody has searched carries no count to read past.
 */
export function GridSearch ({ placeholder, view, children }) {
  return (
    <Flex alignItems='end' gap='size-200' marginTop='size-200' wrap>
      {/* The width is set in theme.css, not here: the field has to be wide enough for
          its placeholder AND able to shrink on a narrow screen, and the second half is
          a flex rule rather than a number. */}
      <div className='erp-search'>
        <SearchField label='Search' placeholder={placeholder} width='100%' {...view.searchProps} />
      </div>
      {children}
      {view.shown !== view.total && (
        <Text marginBottom='size-100'>{view.shown} of {view.total}</Text>
      )}
    </Flex>
  )
}
