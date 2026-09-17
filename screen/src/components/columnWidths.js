/*
 * Resizable table columns that stay the width someone dragged them to, and never push
 * the table wider than it is. Widths are kept per table in this browser; a browser that
 * blocks storage simply starts from the defaults each time.
 *
 * Spectrum freezes the columns left of a dragged one at their current widths and keeps
 * the rest as declared, and nothing caps the total. So the widths are held here
 * (Spectrum's controlled columns) and each drag is trimmed as it happens:
 * - the last column is never dragged and never stored: it takes what the others leave;
 * - a column can grow only until everything to its right is at its minimum.
 */
import { useCallback, useRef, useState } from 'react'

const PREFIX = 'demo-erp.columns.'
/** No column is dragged narrower than this. */
export const MIN_COLUMN_WIDTH = 80
const FILL = '1fr'

function read (tableId) {
  try {
    return JSON.parse(window.localStorage.getItem(PREFIX + tableId)) || {}
  } catch (e) {
    return {}
  }
}

const isFlexible = (size) => size === undefined || typeof size === 'string'
const minOf = (column) => column.minWidth ?? MIN_COLUMN_WIDTH

/**
 * The dragged column's width, trimmed so the columns right of it still fit at their
 * minimum (a flexible column) or their current width (a fixed one).
 */
function trimmed (columns, sizes, widths, dragged, tableWidth) {
  const at = columns.findIndex((c) => c.key === dragged)
  const taken = columns.reduce((sum, c, i) => {
    if (i === at) return sum
    if (i > at && isFlexible(sizes[c.key])) return sum + minOf(c)
    const width = widths.get(c.key)
    return sum + (typeof width === 'number' ? width : minOf(c))
  }, 0)
  const room = Math.floor(tableWidth - taken)
  return Math.max(minOf(columns[at]), Math.min(widths.get(dragged), room))
}

/**
 * @param {string} tableId one name per table
 * @param {Array<{ key: string, width?: number|string, minWidth?: number }>} columns in
 *   display order, declared once outside the component; `width` is the default, and a
 *   column without one shares the space left
 * @returns {{ tableProps: object, columnProps: (key: string) => object }} spread
 *   `tableProps` on the TableView and `columnProps(key)` on each Column
 */
export function useColumnWidths (tableId, columns) {
  const lastKey = columns[columns.length - 1].key
  const [sizes, setSizes] = useState(() => {
    const saved = read(tableId)
    return Object.fromEntries(columns.map((c) => [c.key, c.key === lastKey ? FILL : (saved[c.key] ?? c.width)]))
  })
  const tableRef = useRef(null)
  const tableWidth = useRef(0)

  // The width the columns share: the table body's, less any vertical scrollbar.
  const onResizeStart = useCallback(() => {
    const node = tableRef.current && tableRef.current.UNSAFE_getDOMNode()
    const body = node && node.querySelector('[class*=spectrum-Table-body]')
    tableWidth.current = (body || node)?.clientWidth ?? 0
  }, [])

  const onResize = useCallback((widths) => {
    setSizes((current) => {
      // The dragged column is the right-most one whose width changed; Spectrum
      // freezes the ones before it and leaves the ones after it as they were.
      const dragged = [...columns].reverse().find((c) => c.key !== lastKey && widths.get(c.key) !== current[c.key])
      if (!dragged) return current
      const next = Object.fromEntries(columns.map((c) => [c.key, widths.get(c.key)]))
      next[dragged.key] = trimmed(columns, current, widths, dragged.key, tableWidth.current)
      next[lastKey] = FILL
      return next
    })
  }, [columns, lastKey])

  const onResizeEnd = useCallback(() => {
    setSizes((current) => {
      try {
        const { [lastKey]: _fill, ...stored } = current
        window.localStorage.setItem(PREFIX + tableId, JSON.stringify(stored))
      } catch (e) {
        // Storage blocked: the widths last for this page only.
      }
      return current
    })
  }, [lastKey, tableId])

  const columnProps = useCallback((key) => ({
    allowsResizing: key !== lastKey,
    minWidth: minOf(columns.find((c) => c.key === key)),
    width: sizes[key]
  }), [columns, lastKey, sizes])

  return { tableProps: { ref: tableRef, onResizeStart, onResize, onResizeEnd }, columnProps }
}
