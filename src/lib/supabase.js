import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env vars. Create a .env file based on .env.example'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ───────────────────────────────────────────────────────────────────────────
// fetchAllRows — paginate past Supabase's hard 1,000-row response cap.
//
// PostgREST (and therefore supabase-js) returns at most 1,000 rows per request
// regardless of how many match. A plain `.select()` therefore silently drops
// everything after the first 1,000 — which is exactly why only ~1,000 items
// were ever showing up. This helper transparently pages through the full set
// using `.range()` until every row has been retrieved.
//
// `makeQuery` MUST return a *fresh* query builder on every call, because each
// builder is single-use once `.range()` / `await` has been applied. Example:
//
//   const items = await fetchAllRows(() =>
//     supabase.from('items').select('*, stores(name)').order('name')
//   )
//
// ───────────────────────────────────────────────────────────────────────────
export async function fetchAllRows(makeQuery, { pageSize = 1000, onProgress } = {}) {
  let from = 0
  const all = []
  // Safety cap: 500 pages = 500k rows. Prevents an accidental infinite loop.
  for (let page = 0; page < 500; page++) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1)
    if (error) throw error
    const batch = data || []
    all.push(...batch)
    onProgress?.(all.length)
    if (batch.length < pageSize) break
    from += pageSize
  }
  return all
}

// selectAll — drop-in `{ data, error }` wrapper around fetchAllRows so existing
// `const { data } = await supabase...` call sites can page past 1,000 rows with
// a one-line change: wrap the builder in `selectAll(() => supabase...)`.
export async function selectAll(makeQuery, opts) {
  try {
    return { data: await fetchAllRows(makeQuery, opts), error: null }
  } catch (error) {
    return { data: null, error }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// chunkedUpsert / chunkedInsert — write large datasets in batches.
//
// Sending thousands of rows one-at-a-time (a network round-trip per row) is
// what made bulk CSV imports of 6,000+ items crawl and time out. Batching into
// chunks of ~500 keeps each request well under PostgREST limits while cutting
// round-trips by ~500x. Returns { success, failed, errors }.
// ───────────────────────────────────────────────────────────────────────────
export async function chunkedWrite(table, rows, {
  mode = 'insert',          // 'insert' | 'upsert'
  onConflict,               // required for upsert
  chunkSize = 500,
  onProgress,               // (doneCount, total) => void
} = {}) {
  let success = 0
  let failed = 0
  const errors = []
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    let error
    if (mode === 'upsert') {
      ({ error } = await supabase.from(table).upsert(chunk, { onConflict, ignoreDuplicates: false }))
    } else {
      ({ error } = await supabase.from(table).insert(chunk))
    }
    if (error) {
      // A whole-chunk failure (e.g. one bad row) — retry row-by-row so the
      // good rows in the chunk still get written and we can report the bad ones.
      for (const row of chunk) {
        let rowErr
        if (mode === 'upsert') {
          ({ error: rowErr } = await supabase.from(table).upsert(row, { onConflict, ignoreDuplicates: false }))
        } else {
          ({ error: rowErr } = await supabase.from(table).insert(row))
        }
        if (rowErr) { failed++; errors.push(rowErr.message) }
        else success++
      }
    } else {
      success += chunk.length
    }
    onProgress?.(Math.min(i + chunkSize, rows.length), rows.length)
  }
  return { success, failed, errors }
}
