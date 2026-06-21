// ────────────────────────────────────────────────────────────────────────────
// excelExport.js — well-designed, coloured & formatted .xlsx exports (ExcelJS)
//
// Two builders:
//   • exportExpiringItemsExcel(rows, meta)  → Item Expiry report
//   • exportOrderExcel(groupedRows, meta)   → Purchase order sheet
// Both produce a styled workbook and trigger a browser download.
//
// ExcelJS is ~900 kB, so it's dynamically imported only when an export actually
// runs — it never weighs down the initial page load.
// ────────────────────────────────────────────────────────────────────────────

const BRAND = 'FF00AEEF'   // Outrigger cyan (ARGB)
const BRAND_DARK = 'FF0090C5'
const WHITE = 'FFFFFFFF'
const GREY_ROW = 'FFF4F7FA'

function downloadBuffer(buffer, filename) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

function fill(color) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }
}
function border() {
  const s = { style: 'thin', color: { argb: 'FFD7DEE6' } }
  return { top: s, left: s, bottom: s, right: s }
}

// Colour for an expiry "days left" value
function expiryColors(days) {
  if (days === null || days === undefined) return { bg: 'FFF1F5F9', txt: 'FF64748B' }
  if (days < 0)   return { bg: 'FFFFE4E6', txt: 'FFB91C1C' } // expired – red
  if (days <= 7)  return { bg: 'FFFEE2E2', txt: 'FFDC2626' } // ≤7d – red
  if (days <= 15) return { bg: 'FFFFEDD5', txt: 'FFEA580C' } // ≤15d – orange
  if (days <= 30) return { bg: 'FFFEF9C3', txt: 'FFCA8A04' } // ≤30d – yellow
  if (days <= 60) return { bg: 'FFE0F2FE', txt: 'FF0369A1' } // ≤60d – blue
  return { bg: 'FFDCFCE7', txt: 'FF15803D' }                 // good – green
}

// ── Shared header band ──────────────────────────────────────────────────────
function addTitleBand(ws, title, subtitle, lastCol) {
  ws.mergeCells(1, 1, 1, lastCol)
  const t = ws.getCell(1, 1)
  t.value = title
  t.font = { name: 'Calibri', size: 18, bold: true, color: { argb: WHITE } }
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  t.fill = fill(BRAND)
  ws.getRow(1).height = 32

  ws.mergeCells(2, 1, 2, lastCol)
  const s = ws.getCell(2, 1)
  s.value = subtitle
  s.font = { name: 'Calibri', size: 10, color: { argb: WHITE } }
  s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  s.fill = fill(BRAND_DARK)
  ws.getRow(2).height = 20
}

function styleHeaderRow(ws, rowIdx, headers) {
  const row = ws.getRow(rowIdx)
  headers.forEach((h, i) => {
    const c = row.getCell(i + 1)
    c.value = h
    c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: WHITE } }
    c.fill = fill('FF1E293B')
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    c.border = border()
  })
  row.height = 26
}

// ════════════════════════════════════════════════════════════════════════════
// 1) ITEM EXPIRY REPORT
//   rows: [{ part_number, name, store, current_stock, unit, expiry_date, days, source }]
// ════════════════════════════════════════════════════════════════════════════
export async function exportExpiringItemsExcel(rows, meta = {}) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Outrigger Maafushivaru Inventory'
  wb.created = new Date()
  const ws = wb.addWorksheet('Expiring Items', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { fitToPage: true, fitToWidth: 1, orientation: 'landscape' },
  })

  const headers = ['#', 'Part #', 'Item Name', 'Store', 'In Stock', 'Unit', 'Expiry Date', 'Days Left', 'Status', 'Recommended Action']
  ws.columns = [
    { width: 5 }, { width: 13 }, { width: 34 }, { width: 20 },
    { width: 10 }, { width: 8 }, { width: 14 }, { width: 11 }, { width: 14 }, { width: 30 },
  ]

  addTitleBand(ws, 'Item Expiry Report', `${meta.resortName || 'Outrigger Maafushivaru Resort'}  ·  Generated ${meta.date || new Date().toLocaleDateString()}  ·  ${rows.length} item(s) within ${meta.rangeLabel || '4 months'}`, headers.length)
  styleHeaderRow(ws, 4, headers)

  rows.forEach((r, idx) => {
    const rowIdx = idx + 5
    const days = r.days
    const col = expiryColors(days)
    const status =
      days === null ? 'No date' :
      days < 0      ? `Expired ${Math.abs(days)}d` :
      `${days}d left`
    const action =
      days === null ? '—' :
      days < 0      ? 'Dispose / return now' :
      days <= 7     ? 'Use immediately' :
      days <= 15    ? 'Prioritise in issuances' :
      days <= 30    ? 'Plan to use this month' :
      'Monitor'

    const vals = [idx + 1, r.part_number || '—', r.name || '', r.store || '—',
      Number(r.current_stock) || 0, r.unit || '', r.expiry_date || '—',
      days === null ? '—' : days, status, action]

    const row = ws.getRow(rowIdx)
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1)
      c.value = v
      c.border = border()
      c.font = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } }
      c.alignment = {
        vertical: 'middle',
        horizontal: [0, 4, 5, 7].includes(i) ? 'center' : 'left',
        indent: [0, 4, 5, 7].includes(i) ? 0 : 1,
      }
      if (idx % 2 === 1) c.fill = fill(GREY_ROW)
    })
    // colour the Days-Left + Status cells by urgency
    ;[8, 9].forEach(ci => {
      const c = row.getCell(ci)
      c.fill = fill(col.bg)
      c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: col.txt } }
    })
    row.height = 20
  })

  // Footer note
  const noteRow = rows.length + 6
  ws.mergeCells(noteRow, 1, noteRow, headers.length)
  const note = ws.getCell(noteRow, 1)
  note.value = 'Sorted shortest → longest time to expiry. Generated automatically by the Inventory Management System.'
  note.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF94A3B8' } }

  const buf = await wb.xlsx.writeBuffer()
  downloadBuffer(buf, meta.filename || `Expiry_Report_${new Date().toISOString().split('T')[0]}.xlsx`)
}

// ════════════════════════════════════════════════════════════════════════════
// 2) PURCHASE ORDER SHEET
//   grouped: { [storeName]: [{ part_number, name, unit, current_stock, avgWeekly, suggested, ordered, note }] }
// ════════════════════════════════════════════════════════════════════════════
export async function exportOrderExcel(grouped, meta = {}) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Outrigger Maafushivaru Inventory'
  wb.created = new Date()
  const ws = wb.addWorksheet('Purchase Order', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { fitToPage: true, fitToWidth: 1, orientation: 'portrait' },
  })

  const headers = ['Part #', 'Item Name', 'Unit', 'In Stock', 'Avg/Week', 'Suggested', 'Order Qty', 'Notes']
  ws.columns = [
    { width: 13 }, { width: 36 }, { width: 8 }, { width: 10 },
    { width: 10 }, { width: 11 }, { width: 11 }, { width: 24 },
  ]

  addTitleBand(ws, 'Purchase Order', `${meta.resortName || 'Outrigger Maafushivaru Resort'}  ·  Delivery: ${meta.deliveryLabel || '—'}`, headers.length)
  styleHeaderRow(ws, 4, headers)

  let r = 5
  let grandQty = 0
  for (const [store, items] of Object.entries(grouped)) {
    // store sub-header
    ws.mergeCells(r, 1, r, headers.length)
    const sh = ws.getCell(r, 1)
    sh.value = `▸  ${store || 'Unassigned'}  (${items.length} item${items.length !== 1 ? 's' : ''})`
    sh.font = { name: 'Calibri', size: 11, bold: true, color: { argb: BRAND_DARK } }
    sh.fill = fill('FFEAF7FE')
    sh.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    ws.getRow(r).height = 22
    r++

    items.forEach((it, idx) => {
      const vals = [it.part_number || '—', it.name || '', it.unit || '',
        Number(it.current_stock) || 0, it.avgWeekly ?? '', it.suggested ?? '',
        Number(it.ordered) || 0, it.note || (it._manuallyAdded ? 'Manual' : (it._pendingNote || ''))]
      grandQty += Number(it.ordered) || 0
      const row = ws.getRow(r)
      vals.forEach((v, i) => {
        const c = row.getCell(i + 1)
        c.value = v
        c.border = border()
        c.font = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } }
        c.alignment = { vertical: 'middle', horizontal: [2, 3, 4, 5, 6].includes(i) ? 'center' : 'left', indent: [2, 3, 4, 5, 6].includes(i) ? 0 : 1 }
        if (idx % 2 === 1) c.fill = fill(GREY_ROW)
      })
      // highlight the order-qty column
      const oq = row.getCell(7)
      oq.fill = fill('FFDBF3FF')
      oq.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF075985' } }
      row.height = 19
      r++
    })
  }

  // Grand total row
  ws.mergeCells(r, 1, r, 6)
  const tl = ws.getCell(r, 1)
  tl.value = 'TOTAL UNITS TO ORDER'
  tl.font = { name: 'Calibri', size: 11, bold: true, color: { argb: WHITE } }
  tl.fill = fill('FF1E293B')
  tl.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 }
  const tv = ws.getCell(r, 7)
  tv.value = grandQty
  tv.font = { name: 'Calibri', size: 12, bold: true, color: { argb: WHITE } }
  tv.fill = fill(BRAND)
  tv.alignment = { vertical: 'middle', horizontal: 'center' }
  ws.getCell(r, 8).fill = fill('FF1E293B')
  ws.getRow(r).height = 24

  const buf = await wb.xlsx.writeBuffer()
  downloadBuffer(buf, meta.filename || `Order_${new Date().toISOString().split('T')[0]}.xlsx`)
}
