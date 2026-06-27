// ─────────────────────────────────────────────────────────────────────────
// storeMatch.js
// Robust store resolution for CSV imports.
//
// THE BUG THIS FIXES:
// Imports used to match the `store_name` column ONLY against exact store names.
// So a value like "beverage" (which is a CATEGORY, not the name of any store —
// the actual store might be "Beverage Dry Store") matched nothing, and every
// such row was silently dumped into the fallback store (General). Result: a CSV
// that said "beverage" everywhere uploaded entirely into General.
//
// This resolver matches by store name first, then falls back to the main
// CATEGORY (Food / General / Beverage), and tolerates case / spacing. It also
// honours an optional `category` column.
// ─────────────────────────────────────────────────────────────────────────

export const MAIN_CATEGORIES = ['Food', 'General', 'Beverage']

const norm = (s) => (s ?? '').toString().trim().replace(/\s+/g, ' ').toLowerCase()

// Resolve a typed value to one of the known categories (canonical casing).
export function matchCategory(value, stores = []) {
  const v = norm(value)
  if (!v) return null
  const canon = MAIN_CATEGORIES.find((c) => norm(c) === v)
  if (canon) return canon
  // Also accept any category actually present in the data (defensive).
  const present = [...new Set(stores.map((s) => s.category).filter(Boolean))]
  return present.find((c) => norm(c) === v) || null
}

// Pick a representative store for a category: prefer a store named exactly like
// the category, otherwise the alphabetically-first store in that category.
export function storeForCategory(category, stores = []) {
  if (!category) return null
  const inCat = stores.filter((s) => norm(s.category) === norm(category))
  if (!inCat.length) return null
  const exact = inCat.find((s) => norm(s.name) === norm(category))
  if (exact) return exact
  return [...inCat].sort((a, b) => (a.name || '').localeCompare(b.name || ''))[0]
}

// Resolve a row's store.
// Returns { store, matchedBy } where matchedBy ∈ 'name' | 'category' |
// 'category-column' | null.
export function resolveStore(storeName, stores = [], categoryColumn = '') {
  const sName = norm(storeName)

  // 1) Exact store-name match (case / spacing insensitive).
  if (sName) {
    const byName = stores.find((s) => norm(s.name) === sName)
    if (byName) return { store: byName, matchedBy: 'name' }
  }

  // 2) store_name is actually a main category (e.g. "beverage").
  const catFromName = matchCategory(storeName, stores)
  if (catFromName) {
    const s = storeForCategory(catFromName, stores)
    if (s) return { store: s, matchedBy: 'category' }
  }

  // 3) Explicit `category` column on the row.
  const catCol = matchCategory(categoryColumn, stores)
  if (catCol) {
    const s = storeForCategory(catCol, stores)
    if (s) return { store: s, matchedBy: 'category-column' }
  }

  return { store: null, matchedBy: null }
}

export function resolveStoreId(storeName, stores = [], categoryColumn = '') {
  return resolveStore(storeName, stores, categoryColumn).store?.id || null
}
