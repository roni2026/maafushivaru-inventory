// ─────────────────────────────────────────────────────────────────────────────
// boatnote.js — parse a "Boat Note" spreadsheet (xlsx / csv) into clean item rows.
//
// Boat notes come in MANY column layouts (the date sometimes sits in the product
// header cell, Unit/Qty are sometimes swapped, the code column is sometimes
// unlabelled, PO-first vs Supplier-first, etc). This parser mirrors the tested
// Python normaliser: it locates the header row, maps columns by header text with
// positional + content fallbacks, fills down the supplier/PO, skips section
// banners ("MALE ITEM", "BONDED ITEMS"), and fixes Unit/Qty swaps.
// ─────────────────────────────────────────────────────────────────────────────
import ExcelJS from 'exceljs'

// Canonical department names + the short forms that appear on the notes.
export const DEPARTMENTS = [
  'STORE', 'MAIN KITCHEN', 'STAFF KITCHEN', 'STAFF SHOP', 'HOST SHOP',
  'ENGINEERING', 'CLINIC', 'IT', 'HOUSEKEEPING', 'TRANSPORT', 'SPA',
]
const DEPT_ALIASES = {
  'MAIN KIT': 'MAIN KITCHEN', 'STAFF KIT': 'STAFF KITCHEN', 'STAFFKIT': 'STAFF KITCHEN',
  'ENG': 'ENGINEERING', 'HOUSE KEEPING': 'HOUSEKEEPING', 'HK': 'HOUSEKEEPING',
  'MAIN STORE': 'STORE', 'NAVASANA SPA': 'SPA',
}
export function normDept(s) {
  const t = String(s || '').trim().toUpperCase()
  return DEPT_ALIASES[t] || t
}

// ── LOCAL vs FOREIGN classifier ────────────────────────────────────────
// Foreign supplies arrive on Monday, local supplies on Thursday. Local =
// fresh produce / fish / locally-made snacks; everything else is foreign.
const LOCAL_KW = [
  'BANANA', 'WATERMELON', 'PINEAPPLE', 'PAPAYA', 'MELON', 'CARROT', 'ONION',
  'TOMATO', 'GUAVA', 'COCONUT', 'KURUMBA', 'AVELI', 'RIHAAKURU', 'BAJIYA',
  'ROSHI', 'MAS FOTHI', 'KULHI', 'GARLIC', 'LIME', 'LETTUCE', 'CUCUMBER',
  'CABBAGE', 'FISH CLEANED', 'JOB FISH', 'REEF', 'GROUPER', 'FRESH MILK',
  'DHIYA HAKURU', 'KUDHI', 'LUIKAANAA', 'YOUNG COCONUT', 'SWEET POTATO',
  'POTATOES', 'ORANGE', 'FRUIT -', 'LOCAL', 'BASIL', 'HERB', 'LEAF',
]
export function classifyOrigin(name) {
  const n = String(name || '').toUpperCase()
  if (/CHIP|CRISP|PRINGLE|CANDY|BISCUIT/.test(n)) return 'foreign'  // packaged snacks
  return LOCAL_KW.some(k => n.includes(k)) ? 'local' : 'foreign'
}
// Monday = foreign delivery, Thursday = local delivery.
export function deliveryDayFor(origin) {
  return origin === 'local' ? 'Thursday' : 'Monday'
}

// ── Low-level cell helpers ─────────────────────────────────────────────
const SECTION_RE = /^(MALE ITEM|BONDED ITEM|MALE ITEMS|BONDED ITEMS|ISLAND ITEM)/i
function txt(v) {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object' && v.text) return String(v.text).trim()      // exceljs rich text
  if (typeof v === 'object' && v.result !== undefined) return String(v.result).trim() // formula
  const s = String(v).trim()
  return s.toLowerCase() === 'nan' ? '' : s
}
function isDate(v) { return v instanceof Date }
function isCode(v) {
  const s = txt(v).replace(/\.0$/, '')
  return /^\d{4,15}$/.test(s)
}
function cleanCode(v) {
  let s = txt(v).replace(/\.0$/, '').replace(/^0+/, '')
  return s || ''
}

// Header text → role
function headerRole(h) {
  h = String(h || '').toLowerCase().trim()
  if (!h || h === 'nan' || h === 'none') return null
  if (h.includes('dept') || h.includes('department')) return 'dept'   // before 'part' test
  if (h.includes('suplier') || h.includes('supplier')) return 'supplier'
  if (h.startsWith('po') || h.includes('po number') || h.includes('po no') || h.includes('po #')) return 'po'
  if (h.includes('product') || h.includes('description')) return 'name'
  if (h.includes('code') || h.includes('item #') || h.includes('item code') ||
      h.includes('item no') || h.includes('part #') || h.includes('part no') ||
      h === 'part' || h === 'part#') return 'code'
  if (h === 'unit' || h === 'uom') return 'unit'
  if (h.includes('order qty') || h === 'qty' || h.includes('quantity')) return 'qty'
  if (h.includes('exp')) return 'exp'
  return null
}

// ── Matrix builders ─────────────────────────────────────────────────
export async function workbookToMatrix(arrayBuffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(arrayBuffer)
  const ws = wb.worksheets[0]
  if (!ws) return []
  const matrix = []
  ws.eachRow({ includeEmpty: true }, (row) => {
    const vals = row.values || []      // 1-indexed (vals[0] is undefined)
    const out = []
    for (let c = 1; c < vals.length; c++) out.push(vals[c] ?? null)
    matrix.push(out)
  })
  return matrix
}
export function csvToMatrix(text) {
  // Minimal CSV parser handling quoted fields and embedded commas.
  const rows = []
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const cells = []; let cur = ''; let q = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
        else if (ch === '"') q = false
        else cur += ch
      } else if (ch === '"') q = true
      else if (ch === ',') { cells.push(cur); cur = '' }
      else cur += ch
    }
    cells.push(cur)
    rows.push(cells)
  }
  return rows
}

// ── Core extraction ───────────────────────────────────────────────────
export function extractBoatNote(matrix) {
  const nrows = matrix.length
  const ncols = matrix.reduce((m, r) => Math.max(m, r.length), 0)
  const at = (r, c) => (matrix[r] ? matrix[r][c] : null)

  // 1. locate header row
  let hdr = null
  for (let i = 0; i < Math.min(8, nrows); i++) {
    const j = (matrix[i] || []).map(x => txt(x).toLowerCase()).join(' ')
    if (j.includes('product') || j.includes('description') ||
        (j.includes('supplier') && j.includes('po')) || j.includes('department') ||
        (j.includes('unit') && j.includes('qty'))) { hdr = i; break }
  }
  if (hdr == null) return { items: [], depts: [], noteDate: null }

  // 2. map columns from the header text
  const roles = {}          // col -> role
  let nameCol = null
  for (let c = 0; c < ncols; c++) {
    const v = at(hdr, c)
    if (isDate(v)) { nameCol = c; continue }       // date sits in the product column
    const role = headerRole(txt(v))
    if (role && !(c in roles) && !Object.values(roles).includes(role)) roles[c] = role
  }
  const has = (role) => Object.values(roles).includes(role)
  const colOf = (role) => Number(Object.keys(roles).find(c => roles[c] === role))
  const body = []
  for (let r = hdr + 1; r < Math.min(hdr + 50, nrows); r++) body.push(r)
  const score = (c, pred) => body.filter(r => pred(at(r, c))).length

  // 3. fallbacks ---------------------------------------------------------------
  if (!has('name')) {
    if (nameCol != null) roles[nameCol] = 'name'
    else {
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
  }
  if (!has('supplier') && !(0 in roles)) roles[0] = 'supplier'
  if (!has('po') && !(1 in roles) &&
      score(1, v => /PO|REQ|SAMPLE/i.test(txt(v))) >= 2) roles[1] = 'po'
  if (!has('code')) {
    for (let c = 0; c < ncols; c++) {
      if (c in roles) continue
      if (score(c, isCode) >= 3) { roles[c] = 'code'; break }
    }
  }
  if (!has('unit') || !has('qty')) {
    for (let c = 0; c < ncols; c++) {
      if (c in roles) continue
      const vals = body.map(r => txt(at(r, c))).filter(Boolean)
      if (!vals.length) continue
      const alpha = vals.filter(v => /^[A-Za-z./ ]{1,6}$/.test(v)).length
      const num = vals.filter(v => /^\d+(\.\d+)?$/.test(v)).length
      if (!has('unit') && alpha > vals.length * 0.6) roles[c] = 'unit'
      else if (!has('qty') && num > vals.length * 0.6) roles[c] = 'qty'
    }
  }
  if (!has('dept')) {
    const dn = DEPARTMENTS
    for (let c = ncols - 1; c >= 0; c--) {
      if (c in roles) continue
      if (score(c, v => dn.includes(normDept(txt(v)))) >= 3) { roles[c] = 'dept'; break }
    }
  }

  // note date — any date cell in the header band
  let noteDate = null
  for (let r = 0; r <= hdr + 1 && r < nrows; r++)
    for (let c = 0; c < ncols; c++)
      if (isDate(at(r, c))) { noteDate = at(r, c).toISOString().slice(0, 10); break }

  // 4. walk the body ----------------------------------------------------------
  const items = []
  let lastSup = '', lastPo = '', line = 0
  const g = (r, role) => has(role) ? txt(at(r, colOf(role))) : ''
  for (let r = hdr + 1; r < nrows; r++) {
    let sup = g(r, 'supplier'), name = g(r, 'name'), po = g(r, 'po')
    if (SECTION_RE.test(sup) || SECTION_RE.test(name)) continue
    let code = g(r, 'code'), unit = g(r, 'unit'), qty = g(r, 'qty')
    const dept = g(r, 'dept'), exp = g(r, 'exp')
    if (sup) lastSup = sup
    if (po) lastPo = po
    if (!name) continue
    // fix Unit/Qty swap
    if (qty && /^[A-Za-z./ ]{1,6}$/.test(qty) && unit && /^\d+(\.\d+)?$/.test(unit)) {
      const t = unit; unit = qty; qty = t
    }
    const qn = qty ? parseFloat(qty.replace(/[^0-9.]/g, '')) : NaN
    if (!isFinite(qn)) continue
    line++
    items.push({
      line_no: line,
      supplier: lastSup,
      po_number: lastPo,
      part_number: isCode(code) ? cleanCode(code) : (code || ''),
      product_name: name,
      unit: (unit || 'EA').toUpperCase(),
      ordered_qty: qn,
      expiry_date: /^\d{4}-\d{2}-\d{2}/.test(exp) ? exp.slice(0, 10) : '',
      department: normDept(dept),
    })
  }
  const depts = [...new Set(items.map(i => i.department).filter(Boolean))].sort()
  return { items, depts, noteDate }
}

// One-shot: file → { items, depts, noteDate }
export async function parseBoatNoteFile(file) {
  const name = (file.name || '').toLowerCase()
  if (name.endsWith('.csv')) {
    const text = await file.text()
    return extractBoatNote(csvToMatrix(text))
  }
  if (name.endsWith('.xls')) {
    throw new Error('Legacy .xls files are not supported in the browser. Please save as .xlsx or .csv and re-upload.')
  }
  const buf = await file.arrayBuffer()
  return extractBoatNote(await workbookToMatrix(buf))
}
