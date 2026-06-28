// ────────────────────────────────────────────────────────────────────────────
// fuelExcel.js — export the DIVE CENTRE FUEL log as a styled .xlsx that mirrors
// the original "DIVE CENTRE FUEL 2026" sheet:
//
//   ┌──────────────────────────────────────────────────────────────────┐
//   │ DIVE CENTRE                                                        │  (title)
//   ├───────────────────────────────┬──────────────────────────────────┤
//   │ PETROL - JUNE - 2026          │   DIESEL - JUNE - 2026             │
//   ├──────┬───────────┬─────┬──────┼──────┬───────────┬─────┬──────────┤
//   │ Date │ Boat Name │ Qty │ Unit │ Date │ Boat Name │ Qty │ Unit     │
//   │ ...  │ ...       │ ... │ Ltrs │ ...  │ ...       │ ... │ Ltrs     │
//   │      │ TOTAL     │2405 │ Ltrs │      │ TOTAL     │3166 │ Ltrs     │
//   └──────┴───────────┴─────┴──────┴──────┴───────────┴─────┴──────────┘
//
// Petrol fills columns A–D, a spacer column E, diesel fills columns F–I. One
// block is produced per operational month (month_key). ExcelJS is dynamically
// imported so it never weighs down the initial page load.
// ────────────────────────────────────────────────────────────────────────────

const BRAND      = 'FF00AEEF'
const PETROL_BG  = 'FFFEF3C7'   // warm amber band for petrol
const PETROL_TXT = 'FF92400E'
const DIESEL_BG  = 'FFDBEAFE'   // cool blue band for diesel
const DIESEL_TXT = 'FF1E40AF'
const WHITE      = 'FFFFFFFF'
const HEAD_BG    = 'FF1E293B'
const GREY_ROW   = 'FFF4F7FA'

function downloadBuffer(buffer, filename) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}
function fill(color) { return { type: 'pattern', pattern: 'solid', fgColor: { argb: color } } }
function border() {
  const s = { style: 'thin', color: { argb: 'FFD7DEE6' } }
  return { top: s, left: s, bottom: s, right: s }
}

// '2026-06' → 'JUNE - 2026'
function monthTitle(monthKey) {
  const [y, m] = String(monthKey || '').split('-')
  const names = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER']
  const name = names[(Number(m) || 1) - 1] || ''
  return `${name} - ${y || ''}`.trim()
}
// ISO date → dd.mm.yy (matches the original sheet's date style)
export function fmtChitDate(d) {
  if (!d) return ''
  const dt = new Date(d)
  if (isNaN(dt)) return String(d)
  const dd = String(dt.getDate()).padStart(2, '0')
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const yy = String(dt.getFullYear()).slice(-2)
  return `${dd}.${mm}.${yy}`
}

// records: [{ fuel_type:'PETROL'|'DIESEL', fuel_date, boat_name, qty, unit, month_key }]
// meta:    { filename }
export async function exportFuelExcel(records, meta = {}) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Outrigger Maafushivaru Dive Centre'
  wb.created = new Date()
  const ws = wb.addWorksheet('Dive Centre Fuel', {
    pageSetup: { fitToPage: true, fitToWidth: 1, orientation: 'portrait' },
  })

  // A Date | B Boat | C Qty | D Unit | E spacer | F Date | G Boat | H Qty | I Unit
  ws.columns = [
    { width: 11 }, { width: 18 }, { width: 8 }, { width: 8 },
    { width: 3 },
    { width: 11 }, { width: 18 }, { width: 8 }, { width: 8 },
  ]

  // Group by operational month, newest months last (chronological).
  const byMonth = {}
  for (const r of records || []) {
    const key = r.month_key || (r.fuel_date ? String(r.fuel_date).slice(0, 7) : 'unknown')
    ;(byMonth[key] = byMonth[key] || []).push(r)
  }
  const months = Object.keys(byMonth).sort()

  let row = 1
  // Sheet title band
  ws.mergeCells(row, 1, row, 9)
  const t = ws.getCell(row, 1)
  t.value = 'DIVE CENTRE'
  t.font = { name: 'Calibri', size: 16, bold: true, color: { argb: WHITE } }
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  t.fill = fill(BRAND)
  ws.getRow(row).height = 28
  row += 2

  for (const monthKey of months) {
    const monthRecs = byMonth[monthKey]
    const petrol = monthRecs.filter(r => (r.fuel_type || '').toUpperCase() !== 'DIESEL')
      .sort((a, b) => String(a.fuel_date).localeCompare(String(b.fuel_date)))
    const diesel = monthRecs.filter(r => (r.fuel_type || '').toUpperCase() === 'DIESEL')
      .sort((a, b) => String(a.fuel_date).localeCompare(String(b.fuel_date)))

    const title = monthTitle(monthKey)

    // ── month band: PETROL (A–D) | DIESEL (F–I) ──
    ws.mergeCells(row, 1, row, 4)
    const p = ws.getCell(row, 1)
    p.value = `PETROL - ${title}`
    p.font = { name: 'Calibri', size: 12, bold: true, color: { argb: PETROL_TXT } }
    p.fill = fill(PETROL_BG)
    p.alignment = { vertical: 'middle', horizontal: 'center' }
    ws.mergeCells(row, 6, row, 9)
    const d = ws.getCell(row, 6)
    d.value = `DIESEL - ${title}`
    d.font = { name: 'Calibri', size: 12, bold: true, color: { argb: DIESEL_TXT } }
    d.fill = fill(DIESEL_BG)
    d.alignment = { vertical: 'middle', horizontal: 'center' }
    ws.getRow(row).height = 22
    row++

    // ── header row ──
    const headers = ['Date', 'Boat Name', 'Qty', 'Unit']
    const hr = ws.getRow(row)
    headers.forEach((h, i) => {
      const left = hr.getCell(i + 1)       // A–D
      const right = hr.getCell(i + 6)      // F–I
      ;[left, right].forEach(c => {
        c.value = h
        c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: WHITE } }
        c.fill = fill(HEAD_BG)
        c.alignment = { vertical: 'middle', horizontal: 'center' }
        c.border = border()
      })
    })
    hr.height = 20
    row++

    // ── data rows (petrol & diesel side by side) ──
    const maxLen = Math.max(petrol.length, diesel.length)
    let pTotal = 0, dTotal = 0
    let pUnit = 'Ltrs', dUnit = 'Ltrs'
    for (let i = 0; i < maxLen; i++) {
      const rr = ws.getRow(row)
      const pr = petrol[i]
      const dr = diesel[i]
      if (pr) {
        pTotal += Number(pr.qty) || 0
        pUnit = pr.unit || pUnit
        const vals = [fmtChitDate(pr.fuel_date), pr.boat_name || '', Number(pr.qty) || 0, pr.unit || 'Ltrs']
        vals.forEach((v, c) => {
          const cell = rr.getCell(c + 1)
          cell.value = v; cell.border = border()
          cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } }
          cell.alignment = { vertical: 'middle', horizontal: c === 1 ? 'left' : 'center', indent: c === 1 ? 1 : 0 }
          if (i % 2 === 1) cell.fill = fill(GREY_ROW)
        })
      }
      if (dr) {
        dTotal += Number(dr.qty) || 0
        dUnit = dr.unit || dUnit
        const vals = [fmtChitDate(dr.fuel_date), dr.boat_name || '', Number(dr.qty) || 0, dr.unit || 'Ltrs']
        vals.forEach((v, c) => {
          const cell = rr.getCell(c + 6)
          cell.value = v; cell.border = border()
          cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } }
          cell.alignment = { vertical: 'middle', horizontal: c === 1 ? 'left' : 'center', indent: c === 1 ? 1 : 0 }
          if (i % 2 === 1) cell.fill = fill(GREY_ROW)
        })
      }
      rr.height = 17
      row++
    }

    // ── TOTAL rows ──
    const tr = ws.getRow(row)
    const totalCells = (startCol, label, total, unit, bg, txt) => {
      const c1 = tr.getCell(startCol);     c1.border = border()
      const c2 = tr.getCell(startCol + 1); c2.value = label
      const c3 = tr.getCell(startCol + 2); c3.value = total
      const c4 = tr.getCell(startCol + 3); c4.value = unit
      ;[c2, c3, c4].forEach(c => {
        c.border = border()
        c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: txt } }
        c.fill = fill(bg)
      })
      c2.alignment = { vertical: 'middle', horizontal: 'center' }
      c3.alignment = { vertical: 'middle', horizontal: 'center' }
      c4.alignment = { vertical: 'middle', horizontal: 'center' }
    }
    totalCells(1, 'TOTAL', pTotal, pUnit, PETROL_BG, PETROL_TXT)
    totalCells(6, 'TOTAL', dTotal, dUnit, DIESEL_BG, DIESEL_TXT)
    tr.height = 20
    row += 2
  }

  if (months.length === 0) {
    ws.getCell(row, 1).value = 'No fuel records.'
    ws.getCell(row, 1).font = { italic: true, color: { argb: 'FF94A3B8' } }
  }

  const buf = await wb.xlsx.writeBuffer()
  downloadBuffer(buf, meta.filename || `DIVE_CENTRE_FUEL_${new Date().toISOString().split('T')[0]}.xlsx`)
}
