// ─────────────────────────────────────────────────────────────────────────────
// stocktakeImport.js — parse an uploaded physical-count file (.xlsx / .csv).
//
// The store uploads a sheet of physically-counted quantities. Layouts vary, so
// we auto-detect columns by header text with positional fallbacks, keyed off the
// item CODE (part number) — the most reliable join to inventory. Each row yields
// { part_number, name, counted_qty }.  The Stocktake page then matches each code
// to an inventory item, computes variance vs system stock and builds the report.
// ─────────────────────────────────────────────────────────────────────────────
import { workbookToMatrix, csvToMatrix } from './boatnote'

const cleanCode = (s) => String(s ?? '').replace(/\.0$/, '').replace(/^0+/, '').trim()

function txt(v) {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object' && v.text) return String(v.text).trim()
  if (typeof v === 'object' && v.result !== undefined) return String(v.result).trim()
  const s = String(v).trim()
  return s.toLowerCase() === 'nan' ? '' : s
}
const isNum = (v) => /^-?\d+(\.\d+)?$/.test(txt(v).replace(/,/g, ''))
const isCode = (v) => /^\d{3,15}$/.test(txt(v).replace(/\.0$/, ''))

function headerRole(h) {
  h = String(h || '').toLowerCase().trim()
  if (!h) return null
  if (h.includes('part') || h.includes('code') || h.includes('item #') ||
      h.includes('item no') || h.includes('item code') || h.includes('sku')) return 'code'
  if (h.includes('count') || h.includes('physical') || h.includes('actual') ||
      h.includes('counted') || h.includes('qty') || h.includes('quantity') ||
      h.includes('stock')) return 'qty'
  if (h.includes('name') || h.includes('description') || h.includes('product') ||
      h.includes('item')) return 'name'
  if (h.includes('unit') || h === 'uom') return 'unit'
  return null
}

export function extractStocktake(matrix) {
  const nrows = matrix.length
  const ncols = matrix.reduce((m, r) => Math.max(m, r.length), 0)
  const at = (r, c) => (matrix[r] ? matrix[r][c] : null)

  // locate header row in the first 8 rows
  let hdr = null
  for (let i = 0; i < Math.min(8, nrows); i++) {
    const j = (matrix[i] || []).map(x => txt(x).toLowerCase()).join(' ')
    if ((j.includes('code') || j.includes('part') || j.includes('item')) &&
        (j.includes('count') || j.includes('qty') || j.includes('quantity') ||
         j.includes('physical') || j.includes('actual') || j.includes('stock'))) { hdr = i; break }
  }

  const roles = {}
  if (hdr != null) {
    for (let c = 0; c < ncols; c++) {
      const role = headerRole(txt(at(hdr, c)))
      if (role && !Object.values(roles).includes(role)) roles[c] = role
    }
  }
  const has = (role) => Object.values(roles).includes(role)
  const colOf = (role) => Number(Object.keys(roles).find(c => roles[c] === role))
  const start = hdr == null ? 0 : hdr + 1
  const body = []
  for (let r = start; r < Math.min(start + 60, nrows); r++) body.push(r)
  const score = (c, pred) => body.filter(r => pred(at(r, c))).length

  // fallbacks
  if (!has('code')) {
    for (let c = 0; c < ncols; c++) { if (c in roles) continue; if (score(c, isCode) >= 3) { roles[c] = 'code'; break } }
  }
  if (!has('qty')) {
    // last numeric column that isn't the code column
    for (let c = ncols - 1; c >= 0; c--) {
      if (c in roles) continue
      if (score(c, isNum) >= 3) { roles[c] = 'qty'; break }
    }
  }
  if (!has('name')) {
    let best = null, bl = 0
    for (let c = 0; c < ncols; c++) {
      if (c in roles) continue
      const vals = body.map(r => txt(at(r, c)))
      const avg = vals.length ? vals.reduce((s, v) => s + v.length, 0) / vals.length : 0
      const alpha = vals.filter(v => /[A-Za-z]/.test(v)).length
      if (alpha >= 3 && avg > bl) { bl = avg; best = c }
    }
    if (best != null) roles[best] = 'name'
  }

  if (!has('code') || !has('qty')) return { rows: [], error: 'Could not detect a code/part-number column and a counted-quantity column.' }

  const rows = []
  const seen = new Set()
  for (let r = start; r < nrows; r++) {
    const codeRaw = txt(at(r, colOf('code')))
    const code = cleanCode(codeRaw)
    if (!code) continue
    const qRaw = txt(at(r, colOf('qty'))).replace(/,/g, '')
    if (!/^-?\d+(\.\d+)?$/.test(qRaw)) continue
    if (seen.has(code)) continue
    seen.add(code)
    rows.push({
      part_number: code,
      name: has('name') ? txt(at(r, colOf('name'))) : '',
      counted_qty: parseFloat(qRaw),
    })
  }
  return { rows, error: rows.length ? null : 'No valid count rows found.' }
}

export async function parseStocktakeFile(file) {
  const name = (file.name || '').toLowerCase()
  if (name.endsWith('.csv')) return extractStocktake(csvToMatrix(await file.text()))
  if (name.endsWith('.xls')) throw new Error('Legacy .xls is not supported in the browser. Save as .xlsx or .csv and re-upload.')
  return extractStocktake(await workbookToMatrix(await file.arrayBuffer()))
}
