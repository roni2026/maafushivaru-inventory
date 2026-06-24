import { useState, useMemo, useCallback } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// useSort — generic, type-aware client-side sorting for any result tree/table.
//
// Sort by ANY column. Numbers sort numerically, ISO dates chronologically, and
// everything else alphabetically (natural/numeric-aware, case-insensitive).
// Empty/null values always sink to the bottom. Clicking the same column again
// flips the direction.
//
// Keys are field names and may use dot-paths for nested values, e.g.
//   useSort(rows, 'name')
//   <Th {...thProps('name')}>Item</Th>
//   <Th {...thProps('current_stock')}>Stock</Th>
//   <Th {...thProps('stores.name')}>Store</Th>   // nested object
//   {sorted.map(row => ...)}
// ─────────────────────────────────────────────────────────────────────────────
function getPath(obj, path) {
  if (obj == null) return undefined
  if (path.indexOf('.') === -1) return obj[path]
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

export function useSort(rows, initialKey = null, initialDir = 'asc') {
  const [sortKey, setSortKey] = useState(initialKey)
  const [sortDir, setSortDir] = useState(initialDir)

  const toggleSort = useCallback((key) => {
    setSortKey(prev => {
      if (prev === key) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); return key }
      setSortDir('asc'); return key
    })
  }, [])

  const sorted = useMemo(() => {
    if (!sortKey) return rows || []
    const isNumeric = (v) =>
      typeof v === 'number' ||
      (typeof v === 'string' && v.trim() !== '' && /^-?\d+(\.\d+)?$/.test(v.trim()))
    const isIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim())

    const copy = [...(rows || [])]
    copy.sort((a, b) => {
      let av = getPath(a, sortKey), bv = getPath(b, sortKey)
      const aEmpty = av == null || av === ''
      const bEmpty = bv == null || bv === ''
      if (aEmpty && bEmpty) return 0
      if (aEmpty) return 1          // empties always last
      if (bEmpty) return -1
      let cmp
      if (isNumeric(av) && isNumeric(bv)) {
        cmp = parseFloat(av) - parseFloat(bv)
      } else if (isIsoDate(av) && isIsoDate(bv)) {
        cmp = Date.parse(av) - Date.parse(bv)
      } else {
        cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [rows, sortKey, sortDir])

  // Spread onto a <Th>:  <Th {...thProps('name')}>Name</Th>
  const thProps = useCallback((key) => ({
    sortable: true,
    onClick: () => toggleSort(key),
    sorted: sortKey === key ? sortDir : undefined,
  }), [sortKey, sortDir, toggleSort])

  return { sorted, sortKey, sortDir, setSortKey, setSortDir, toggleSort, thProps }
}

export default useSort
