/* Load a list from the api once and after each change; hand back rows, a reload, an error. */
import { useEffect, useState, useCallback } from 'react'

export function useLoad (loader, deps = []) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const reload = useCallback(async () => {
    try {
      const data = await loader()
      setRows(Array.isArray(data) ? data : data.items || [])
      setError(null)
    } catch (e) {
      setError(e)
    }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload() }, [reload])
  return { rows, error, reload }
}
