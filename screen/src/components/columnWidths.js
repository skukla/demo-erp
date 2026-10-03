/*
 * Resizable table columns that stay the width someone dragged them to, and never push
 * the table wider than it is. Widths are kept per table in this browser; a browser that
 * blocks storage simply starts from the defaults each time. Every grid's columns are
 * declared in ./gridColumns.js, which states which ones resize and why.
 *
 * Spectrum freezes the columns left of a dragged one at their current widths and keeps
 * the rest as declared, and nothing caps the total. So the widths are held here
 * (Spectrum's controlled columns) and each drag is settled as it happens:
 * - a SHARE column — declared with a fraction, '1fr' or '2fr' — divides whatever the
 *   fixed ones leave, so the table always fills its area. Every grid has at least one;
 * - a column dragged wider grows first into what the filling shares have above their
 *   minimums, then takes from the columns right of it, nearest first, each down to its
 *   minimum — never past the table's edge. Counting only the shares left a grid sized to
 *   its window (Sales orders at 1,440 px) with no column that could grow at all;
 * - a share dragged while another share still fills keeps the width it was dragged to;
 * - the LAST filling share, dragged, stays a share: the columns right of it give it the
 *   width, or the nearest takes it back;
 * - a share in the last place is never dragged: its right edge is the table's edge.
 */
import { useCallback, useRef, useState } from 'react'

const PREFIX = 'demo-erp.columns.'
/** No column is dragged narrower than this. */
const MIN_COLUMN_WIDTH = 80
/** What a column may hold whose content is one size: a line number, a button, an input, a
    number of fixed length. */
const FIXED_KINDS = new Set(['line', 'action', 'input', 'serial'])
const KINDS = new Set([...FIXED_KINDS, 'key', 'text', 'date', 'amount', 'quantity', 'status'])

function read (tableId) {
  try {
    return JSON.parse(window.localStorage.getItem(PREFIX + tableId)) || {}
  } catch (e) {
    return {}
  }
}

function store (tableId, sizes) {
  try {
    // A width someone chose is stored; a share still filling is a rule, not a width.
    const chosen = Object.entries(sizes).filter(([, size]) => typeof size === 'number')
    window.localStorage.setItem(PREFIX + tableId, JSON.stringify(Object.fromEntries(chosen)))
  } catch (e) {
    // Storage blocked: the widths last for this page only.
  }
}

/** A column that divides what is left rather than holding a width of its own. */
const isShare = (column) => typeof column.width === 'string'
/** A size that is still a share: a share column nobody has pinned by dragging it. */
const isFilling = (size) => typeof size === 'string'
const minOf = (column) => {
  if (column.minWidth !== undefined) return column.minWidth
  return FIXED_KINDS.has(column.holds) ? column.width : MIN_COLUMN_WIDTH
}

/**
 * Whether a column can be dragged: not when it holds something of one size, and not when
 * it is a share in the last place, whose right edge is the table's own.
 *
 * @param {{ key: string, width: number|string, holds: string }} column
 * @param {object[]} columns the grid's columns, in display order
 * @returns {boolean}
 */
export function resizes (column, columns) {
  if (FIXED_KINDS.has(column.holds)) return false
  return !(isShare(column) && column.key === columns[columns.length - 1].key)
}

/**
 * Up to `wanted` px from the resizable columns right of `at` that hold a width, nearest
 * first, each down to its minimum. Writes their new widths into `next`.
 * @returns {number} how much was found
 */
function takeFromRight (columns, next, at, wanted) {
  let found = 0
  for (const c of columns.slice(at + 1)) {
    if (found >= wanted) break
    if (typeof next[c.key] !== 'number' || !resizes(c, columns)) continue
    const given = Math.min(wanted - found, Math.max(0, next[c.key] - minOf(c)))
    next[c.key] -= given
    found += given
  }
  return found
}

/** What the filling shares have above their minimums, the dragged column left out. */
function shareSlack (columns, from, dragged, startWidth, tableWidth) {
  const used = columns.reduce((sum, c) => {
    if (c.key === dragged.key) return sum + startWidth
    return sum + (isFilling(from[c.key]) ? minOf(c) : from[c.key])
  }, 0)
  return Math.max(0, Math.floor(tableWidth - used))
}

/**
 * The column being dragged: the one whose width differs between what Spectrum reported
 * when the drag began and its first step. Nothing else moves in that step, which is why it
 * is asked then and kept: the rule that served before (the right-most changed column)
 * picks a right-hand column once a trade has changed it, and a frozen share when a
 * column at its minimum is dragged narrower. Null until something has moved.
 */
export function draggedKey (columns, fromWidths, widths) {
  const moved = columns.find((c) => widths.get(c.key) !== fromWidths.get(c.key))
  return moved ? moved.key : null
}

/**
 * The column sizes after one step of a drag.
 *
 * @param {object[]} columns the grid's columns, in display order
 * @param {object} drag `key` the dragged column's; `sizes` now; `from` the sizes and
 *   `fromWidths` Spectrum's pixel widths when the drag began; `tableWidth` the width the
 *   columns share
 * @param {Map<string, number|string>} widths what Spectrum reports for this step
 * @returns {object} the sizes by column key
 */
export function resized (columns, { key, sizes, from, fromWidths, tableWidth }, widths) {
  const dragged = columns.find((c) => c.key === key)
  if (!dragged || !resizes(dragged, columns)) return sizes
  const at = columns.indexOf(dragged)
  const startWidth = fromWidths.get(key)
  // Spectrum has already held the width at the column's minimum.
  const delta = widths.get(key) - startWidth
  const next = { ...from }
  const onlyShare = isFilling(from[key]) && columns.filter((c) => isFilling(from[c.key])).length === 1
  if (onlyShare) {
    // It stays a share, so it fills whatever the others leave: they move instead.
    if (delta > 0) takeFromRight(columns, next, at, delta)
    const nearest = columns.slice(at + 1).find((c) => typeof next[c.key] === 'number' && resizes(c, columns))
    if (delta < 0 && nearest) next[nearest.key] -= delta
    return next
  }
  const slack = shareSlack(columns, from, dragged, startWidth, tableWidth)
  const found = delta > slack ? takeFromRight(columns, next, at, delta - slack) : 0
  next[key] = startWidth + Math.min(delta, slack + found)
  return next
}

/** The sizes a grid opens with: what was stored, and at least one share still filling. */
function initial (tableId, columns) {
  for (const c of columns) {
    if (!KINDS.has(c.holds)) throw new Error(`Column ${c.key} of ${tableId} does not say what it holds (gridColumns.js).`)
  }
  const shares = columns.filter(isShare)
  if (shares.length === 0) throw new Error(`Grid ${tableId} has no share column, so it cannot fill its area (gridColumns.js).`)
  const saved = read(tableId)
  const sizes = Object.fromEntries(columns.map((c) => [
    c.key,
    resizes(c, columns) && typeof saved[c.key] === 'number' ? saved[c.key] : c.width
  ]))
  const last = shares[shares.length - 1]
  if (!columns.some((c) => isFilling(sizes[c.key]))) sizes[last.key] = last.width
  return sizes
}

/**
 * @param {string} tableId one name per table
 * @param {Array<{ key: string, width: number|string, minWidth?: number, holds: string }>}
 *   columns in display order, from ./gridColumns.js. A number is a default width someone
 *   can drag; a fraction ('1fr', '2fr') makes a share column. A grid whose set can change
 *   (a document's lines gain Discount) passes it memoised; a new set starts over.
 * @returns {{ tableProps: object, columnProps: (key: string) => object }} spread
 *   `tableProps` on the TableView and `columnProps(key)` on each Column
 */
export function useColumnWidths (tableId, columns) {
  const signature = columns.map((c) => c.key).join(',')
  const [state, setState] = useState(() => ({ signature, sizes: initial(tableId, columns) }))
  let sizes = state.sizes
  if (state.signature !== signature) {
    sizes = initial(tableId, columns)
    setState({ signature, sizes })
  }
  const tableRef = useRef(null)
  const drag = useRef(null)
  const latest = useRef(sizes)
  latest.current = sizes

  const onResizeStart = useCallback((widths) => {
    // The width the columns share: the table body's, less any vertical scrollbar.
    const node = tableRef.current && tableRef.current.UNSAFE_getDOMNode()
    const body = node && node.querySelector('[class*=spectrum-Table-body]')
    drag.current = { from: latest.current, fromWidths: widths, tableWidth: (body || node)?.clientWidth ?? 0 }
  }, [])

  const onResize = useCallback((widths) => {
    const step = drag.current
    if (!step) return
    step.key = step.key || draggedKey(columns, step.fromWidths, widths)
    if (!step.key) return
    setState((s) => ({ ...s, sizes: resized(columns, { ...step, sizes: s.sizes }, widths) }))
  }, [columns])

  const onResizeEnd = useCallback(() => {
    drag.current = null
    setState((s) => {
      store(tableId, s.sizes)
      return s
    })
  }, [tableId])

  const columnProps = useCallback((key) => {
    const column = columns.find((c) => c.key === key)
    return { allowsResizing: resizes(column, columns), minWidth: minOf(column), width: sizes[key] }
  }, [columns, sizes])

  return { tableProps: { ref: tableRef, onResizeStart, onResize, onResizeEnd }, columnProps }
}
