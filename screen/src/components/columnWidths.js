/*
 * Resizable table columns that stay the width someone dragged them to. Widths are kept
 * per table in this browser; a browser that blocks storage simply starts from the
 * defaults each time.
 */
import { useState, useCallback } from 'react'

const PREFIX = 'demo-erp.columns.'
/** No column is dragged narrower than this. */
export const MIN_COLUMN_WIDTH = 80

function read (tableId) {
  try {
    return JSON.parse(window.localStorage.getItem(PREFIX + tableId)) || {}
  } catch (e) {
    return {}
  }
}

/**
 * @param {string} tableId one name per table
 * @returns {{ widthOf: (key: string, fallback?: number|string) => (number|string|undefined), onResizeEnd: (widths: Map) => void }}
 */
export function useColumnWidths (tableId) {
  const [saved] = useState(() => read(tableId))
  const widthOf = useCallback((key, fallback) => saved[key] ?? fallback, [saved])
  const onResizeEnd = useCallback((widths) => {
    try {
      window.localStorage.setItem(PREFIX + tableId, JSON.stringify(Object.fromEntries(widths)))
    } catch (e) {
      // Storage blocked: the widths last for this page only.
    }
  }, [tableId])
  return { widthOf, onResizeEnd }
}
