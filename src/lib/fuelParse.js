// ────────────────────────────────────────────────────────────────────────────
// fuelParse.js — turn an OCR'd fuel chit (text) OR an uploaded "DIVE CENTRE
// FUEL" sheet (xlsx / csv) into clean fuel rows:
//
//   { fuel_type:'PETROL'|'DIESEL', fuel_date:'YYYY-MM-DD', boat_name, qty, unit }
//
// The uploaded-sheet parser understands the original two-column layout
// (petrol on the left, diesel on the right) and the month banners. The OCR-text
// parser is tolerant of messy line breaks from a phone photo.
// ────────────────────────────────────────────────────────────────────────────
import { workbookToMatrix, csvToMatrix } from './boatnote'

const MONTHS = {
  jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
}

// Normalise many date spellings → 'YYYY-MM-DD'. Handles dd.mm.yy, dd/mm/yyyy,
// "28 May 2026", and bare Date objects. Two-digit years map to 2000-2099.
export function normFuelDate(raw, fallbackYear) {
  if (raw == null || raw === '') return ''
  if (raw instanceof Date && !isNaN(raw)) return raw.toISOString().slice(0, 10)
  let s = String(raw).trim()
  // dd.mm.yy / dd/mm/yy / dd-mm-yyyy
  let m = s.match(/^(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})$/)
  if (m) {
    let [, d, mo, y] = m
    d = +d; mo = +mo; y = +y
    if (y < 100) y += 2000
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    }
  }
  // "28 May 2026" / "28 May" / "May 28 2026"
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?\s*(\d{2,4})?$/)
  if (m) {
    const d = +m[1]; const mo = MONTHS[m[2].slice(0,3).toLowerCase()]
    let y = m[3] ? +m[3] : (fallbackYear || new Date().getFullYear())
    if (y < 100) y += 2000
    if (mo) return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`
  }
  m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s*(\d{2,4})?$/)
  if (m) {
    const mo = MONTHS[m[1].slice(0,3).toLowerCase()]; const d = +m[2]
    let y = m[3] ? +m[3] : (fallbackYear || new Date().getFullYear())
    if (y < 100) y += 2000
    if (mo) return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`
  }
  return ''
}

export function monthKeyOf(isoDate) {
  return isoDate ? String(isoDate).slice(0, 7) : ''
}

function txt(v) {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object' && v.text) return String(v.text).trim()
  if (typeof v === 'object' && v.result !== undefined) return String(v.result).trim()
  return String(v).trim()
}
function looksLikeDate(s) {
  s = txt(s)
  return /^\d{1,2}[.\/\-]\d{1,2}[.\/\-]\d{2,4}$/.test(s) ||
         /^\d{1,2}\s+[A-Za-z]{3,}/.test(s) || /^[A-Za-z]{3,}\.?\s+\d{1,2}/.test(s)
}

// ── 1) Parse an uploaded sheet (matrix) in the DIVE CENTRE FUEL layout ───────
export function extractFuelMatrix(matrix) {
  const rows = []
  const ncols = matrix.reduce((m, r) => Math.max(m, r.length), 0)

  // Find a header row containing "Date" and "Boat" (it may appear twice — once
  // for petrol, once for diesel). Locate the column blocks dynamically.
  let headerRow = -1
  for (let i = 0; i < Math.min(12, matrix.length); i++) {
    const joined = (matrix[i] || []).map(c => txt(c).toLowerCase()).join('|')
    if (joined.includes('date') && joined.includes('boat')) { headerRow = i; break }
  }

  // Locate each "Date" column → start of a block (4 cols: Date, Boat, Qty, Unit).
  const blocks = []  // { startCol, fuel_type }
  if (headerRow >= 0) {
    const hdr = matrix[headerRow] || []
    for (let c = 0; c < ncols; c++) {
      if (txt(hdr[c]).toLowerCase() === 'date') {
        // Determine fuel type from the banner row above this column.
        let type = 'PETROL'
        for (let up = headerRow - 1; up >= Math.max(0, headerRow - 3); up--) {
          const around = [txt((matrix[up]||[])[c]), txt((matrix[up]||[])[c-1]), txt((matrix[up]||[])[c+1]), (matrix[up]||[]).map(txt).join(' ')].join(' ').toUpperCase()
          if (around.includes('DIESEL')) { type = 'DIESEL'; break }
          if (around.includes('PETROL')) { type = 'PETROL'; break }
        }
        // If two blocks and we couldn't tell, second block defaults to diesel.
        blocks.push({ startCol: c, fuel_type: type })
      }
    }
  }
  // Fallback: assume petrol at col 0, diesel at col 5 (original layout).
  if (blocks.length === 0) {
    blocks.push({ startCol: 0, fuel_type: 'PETROL' }, { startCol: 5, fuel_type: 'DIESEL' })
  }
  // If both blocks got the same type, force the 2nd to the other type.
  if (blocks.length === 2 && blocks[0].fuel_type === blocks[1].fuel_type) {
    blocks[1].fuel_type = blocks[0].fuel_type === 'PETROL' ? 'DIESEL' : 'PETROL'
  }

  const startScan = headerRow >= 0 ? headerRow + 1 : 0
  for (let r = startScan; r < matrix.length; r++) {
    for (const b of blocks) {
      const dateCell = txt((matrix[r] || [])[b.startCol])
      const boat     = txt((matrix[r] || [])[b.startCol + 1])
      const qtyCell  = txt((matrix[r] || [])[b.startCol + 2])
      const unitCell = txt((matrix[r] || [])[b.startCol + 3]) || 'Ltrs'
      if (/total/i.test(boat) || /total/i.test(dateCell)) continue   // skip total rows
      const iso = normFuelDate(dateCell)
      const qn = parseFloat(String(qtyCell).replace(/[^0-9.]/g, ''))
      if (!iso || !boat || !isFinite(qn) || qn <= 0) continue
      rows.push({
        fuel_type: b.fuel_type,
        fuel_date: iso,
        boat_name: boat,
        qty: qn,
        unit: unitCell || 'Ltrs',
        month_key: monthKeyOf(iso),
      })
    }
  }
  return rows
}

export async function parseFuelFile(file) {
  const name = (file.name || '').toLowerCase()
  let matrix
  if (name.endsWith('.csv')) {
    matrix = csvToMatrix(await file.text())
  } else if (name.endsWith('.xls')) {
    throw new Error('Legacy .xls is not supported. Save as .xlsx or .csv and re-upload.')
  } else {
    matrix = await workbookToMatrix(await file.arrayBuffer())
  }
  return extractFuelMatrix(matrix)
}

// ── 2) Parse OCR text from a phone photo of fuel chits ───────────────────────
// Strategy: scan line-by-line. A "PETROL"/"DIESEL" word switches the current
// fuel type. Any line that contains a date + a number is treated as a chit;
// the words between the date and the qty become the boat name.
export function parseFuelText(text, { defaultType = 'PETROL', defaultUnit = 'Ltrs' } = {}) {
  const rows = []
  let curType = defaultType
  const lines = String(text || '').split(/\r?\n/)
  for (let raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (!line) continue
    const upper = line.toUpperCase()
    if (upper.includes('DIESEL')) curType = 'DIESEL'
    else if (upper.includes('PETROL')) curType = 'PETROL'
    if (/total/i.test(line) && !/\d{1,2}[.\/-]\d{1,2}/.test(line)) continue

    // date token
    const dateMatch = line.match(/(\d{1,2}[.\/\-]\d{1,2}[.\/\-]\d{2,4})/) ||
                      line.match(/(\d{1,2}\s+[A-Za-z]{3,}\.?(?:\s+\d{2,4})?)/)
    if (!dateMatch) continue
    const iso = normFuelDate(dateMatch[1])
    if (!iso) continue

    // remove the date, then find the qty (last standalone number) + unit
    let rest = line.replace(dateMatch[1], ' ').replace(/\b(PETROL|DIESEL)\b/ig, ' ').trim()
    const qtyMatch = rest.match(/(\d+(?:\.\d+)?)\s*(ltrs?|liters?|litres?|l)?\b/i)
    if (!qtyMatch) continue
    const qn = parseFloat(qtyMatch[1])
    if (!isFinite(qn) || qn <= 0) continue
    const unit = qtyMatch[2] ? (qtyMatch[2].toLowerCase().startsWith('l') ? 'Ltrs' : qtyMatch[2]) : defaultUnit
    // boat = text before the qty number
    let boat = rest.slice(0, qtyMatch.index).replace(/[|:;,]+/g, ' ').trim()
    boat = boat.replace(/\b(qty|unit|boat|name|date)\b/ig, '').trim()
    if (!boat) boat = 'Unknown'
    rows.push({ fuel_type: curType, fuel_date: iso, boat_name: boat, qty: qn, unit, month_key: monthKeyOf(iso) })
  }
  return rows
}
