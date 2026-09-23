/*
 * Resizable table columns that stay the width someone dragged them to, and never push
 * the table wider than it is. Widths are kept per table in this browser; a browser that
 * blocks storage simply starts from the defaults each time.
 *
 * Spectrum freezes the columns left of a dragged one at their current widths and keeps
 * the rest as declared, and nothing caps the total. So the widths are held here
 * (Spectrum's controlled columns) and each drag is trimmed as it happens:
 * - a SHARE column — one declared with a fraction, '1fr' or '2fr' — is never dragged
 *   and never stored: the share columns divide whatever the fixed ones leave, so the
 *   table always fills its area;
 * - a column can grow only until everything to its right is at its minimum.
 *
 * A grid with no share column at all gets the old behaviour, its LAST column filling,
 * because a table whose columns are all fixed leaves dead space at the right edge.
 * That used to be the only behaviour, which is why Sales orders gave all its slack to
 * the Move to buttons and Customers gave it to a switch.
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
/** A column that divides what is left rather than holding a width of its own. */
const isShare = (column) => typeof column.width === 'string'
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
 *   display order, declared once outside the component. A number is a default width
 *   someone can drag; a fraction ('1fr', '2fr') makes it a share column, which divides
 *   what the fixed ones leave. Give every share column a `minWidth` that fits its
 *   heading — a sortable heading carries a chevron worth about 24px.
 * @returns {{ tableProps: object, columnProps: (key: string) => object }} spread
 *   `tableProps` on the TableView and `columnProps(key)` on each Column
 */
export function useColumnWidths (tableId, columns) {
  const lastKey = columns[columns.length - 1].key
  // With no share column declared, the last one fills, so no grid ends short.
  const shares = columns.some(isShare)
  const fills = useCallback((column) => (shares ? isShare(column) : column.key === lastKey), [shares, lastKey])
  const [sizes, setSizes] = useState(() => {
    const saved = read(tableId)
    return Object.fromEntries(columns.map((c) => [
      c.key,
      fills(c) ? (isShare(c) ? c.width : FILL) : (saved[c.key] ?? c.width)
    ]))
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
      const dragged = [...columns].reverse().find((c) => !fills(c) && widths.get(c.key) !== current[c.key])
      if (!dragged) return current
      const next = Object.fromEntries(columns.map((c) => [c.key, widths.get(c.key)]))
      next[dragged.key] = trimmed(columns, current, widths, dragged.key, tableWidth.current)
      // Spectrum resolves a share to pixels the moment anything is dragged; put the
      // share back, or the table stops filling after the first drag.
      for (const column of columns.filter(fills)) {
        next[column.key] = isShare(column) ? column.width : FILL
      }
      return next
    })
  }, [columns, lastKey])

  const onResizeEnd = useCallback(() => {
    setSizes((current) => {
      try {
        // Only the fixed columns are stored. A share is a rule, not a width.
        const stored = Object.fromEntries(
          columns.filter((c) => !fills(c)).map((c) => [c.key, current[c.key]])
        )
        window.localStorage.setItem(PREFIX + tableId, JSON.stringify(stored))
      } catch (e) {
        // Storage blocked: the widths last for this page only.
      }
      return current
    })
  }, [columns, fills, tableId])

  const columnProps = useCallback((key) => {
    const column = columns.find((c) => c.key === key)
    return {
      allowsResizing: !fills(column),
      minWidth: minOf(column),
      width: sizes[key]
    }
  }, [columns, fills, sizes])

  return { tableProps: { ref: tableRef, onResizeStart, onResize, onResizeEnd }, columnProps }
}
