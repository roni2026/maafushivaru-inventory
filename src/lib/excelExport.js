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

// ═════════════════════════════════════════════════════════════════════════════
// 3) ITEM MOVEMENT REPORT  (fast / moderate / slow / dead movers)
//   rows: [{ part_number, name, store, unit, stock, issued, txns, perWeek,
//            cover, daysSince, movement }]
//   meta: { periodLabel, rangeLabel, resortName, counts:{fast,moderate,slow,dead}, filename }
// ═════════════════════════════════════════════════════════════════════════════
const MOVE_COLORS = {
  fast:     { bg: 'FFDCFCE7', txt: 'FF15803D', label: 'Fast' },
  moderate: { bg: 'FFE0F2FE', txt: 'FF0369A1', label: 'Moderate' },
  slow:     { bg: 'FFFFEDD5', txt: 'FFC2410C', label: 'Slow' },
  dead:     { bg: 'FFFFE4E6', txt: 'FFB91C1C', label: 'Non-Moving' },
}

export async function exportMovementExcel(rows, meta = {}) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Outrigger Maafushivaru Inventory'
  wb.created = new Date()

  const counts = meta.counts || rows.reduce((a, r) => { a[r.movement] = (a[r.movement] || 0) + 1; return a }, {})

  // ── Summary sheet ──────────────────────────────────────────────────────────
  const sum = wb.addWorksheet('Summary', { pageSetup: { orientation: 'portrait' } })
  sum.columns = [{ width: 26 }, { width: 16 }, { width: 40 }]
  addTitleBand(sum, 'Stock Movement Report',
    `${meta.resortName || 'Outrigger Maafushivaru Resort'}  ·  ${meta.periodLabel || ''}  ·  ${meta.rangeLabel || ''}`, 3)
  styleHeaderRow(sum, 4, ['Category', 'Items', 'Meaning'])
  const summaryRows = [
    ['Fast moving',     counts.fast     || 0, 'Highest issuance velocity'],
    ['Moderate moving', counts.moderate || 0, 'Steady movers'],
    ['Slow moving',     counts.slow     || 0, 'Lowest active velocity'],
    ['Non-moving (dead)', counts.dead   || 0, 'No issuance in the selected period'],
  ]
  summaryRows.forEach((vals, idx) => {
    const key = ['fast', 'moderate', 'slow', 'dead'][idx]
    const col = MOVE_COLORS[key]
    const row = sum.getRow(idx + 5)
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1)
      c.value = v; c.border = border()
      c.font = { name: 'Calibri', size: 11, bold: i === 0, color: { argb: i === 0 ? col.txt : 'FF1E293B' } }
      c.alignment = { vertical: 'middle', horizontal: i === 1 ? 'center' : 'left', indent: i === 1 ? 0 : 1 }
      if (i === 0) c.fill = fill(col.bg)
    })
    row.height = 22
  })

  // ── Detail sheet ───────────────────────────────────────────────────────────
  const ws = wb.addWorksheet('Detail', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { fitToPage: true, fitToWidth: 1, orientation: 'landscape' },
  })
  const headers = ['#', 'Part #', 'Item Name', 'Store', 'Unit', 'In Stock', 'Issued', 'Txns', 'Avg/Week', 'Weeks Cover', 'Last Issued', 'Movement']
  ws.columns = [
    { width: 5 }, { width: 13 }, { width: 34 }, { width: 18 }, { width: 8 },
    { width: 10 }, { width: 10 }, { width: 8 }, { width: 11 }, { width: 12 }, { width: 13 }, { width: 14 },
  ]
  addTitleBand(ws, 'Stock Movement — Detailed',
    `${meta.periodLabel || ''}  ·  ${rows.length} item(s)`, headers.length)
  styleHeaderRow(ws, 4, headers)

  rows.forEach((r, idx) => {
    const rowIdx = idx + 5
    const col = MOVE_COLORS[r.movement] || MOVE_COLORS.moderate
    const cover = r.cover === Infinity ? '∞' : r.cover >= 999 ? '999+' : (r.cover != null ? Math.round(r.cover) : '—')
    const last = r.daysSince == null ? '—' : `${r.daysSince}d ago`
    const vals = [idx + 1, r.part_number || '—', r.name || '', r.store || '—', r.unit || '',
      Number(r.stock) || 0, r.issued ?? 0, r.txns ?? 0, r.perWeek ?? 0, cover, last, col.label]
    const row = ws.getRow(rowIdx)
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1)
      c.value = v; c.border = border()
      c.font = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } }
      c.alignment = { vertical: 'middle', horizontal: [0, 4, 5, 6, 7, 8, 9, 10].includes(i) ? 'center' : 'left', indent: [0, 4, 5, 6, 7, 8, 9, 10].includes(i) ? 0 : 1 }
      if (idx % 2 === 1) c.fill = fill(GREY_ROW)
    })
    const mc = row.getCell(headers.length)
    mc.fill = fill(col.bg)
    mc.font = { name: 'Calibri', size: 10, bold: true, color: { argb: col.txt } }
    row.height = 19
  })

  const buf = await wb.xlsx.writeBuffer()
  downloadBuffer(buf, meta.filename || `Movement_Report_${new Date().toISOString().split('T')[0]}.xlsx`)
}

// ═════════════════════════════════════════════════════════════════════════════
// 4) STOCKTAKE VARIANCE REPORT  (uploaded physical count vs system stock)
//   rows: [{ part_number, item_name, unit, system_qty, counted_qty, variance,
//            variance_pct, variance_value, matched }]
//   meta: { sessionLabel, date, resortName, filename }
// ═════════════════════════════════════════════════════════════════════════════
function varianceColor(v) {
  if (v === 0)  return { bg: 'FFDCFCE7', txt: 'FF15803D' }   // match – green
  if (v > 0)    return { bg: 'FFE0F2FE', txt: 'FF0369A1' }   // surplus – blue
  return { bg: 'FFFFE4E6', txt: 'FFB91C1C' }                 // shortage – red
}

export async function exportStocktakeVarianceExcel(rows, meta = {}) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Outrigger Maafushivaru Inventory'
  wb.created = new Date()
  const ws = wb.addWorksheet('Stocktake Variance', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { fitToPage: true, fitToWidth: 1, orientation: 'landscape' },
  })

  const headers = ['#', 'Part #', 'Item Name', 'Unit', 'System Qty', 'Counted Qty', 'Variance', 'Variance %', 'Value Impact', 'Result']
  ws.columns = [
    { width: 5 }, { width: 13 }, { width: 36 }, { width: 8 }, { width: 12 },
    { width: 12 }, { width: 11 }, { width: 11 }, { width: 13 }, { width: 14 },
  ]

  const matched = rows.filter(r => r.variance === 0).length
  const short   = rows.filter(r => r.variance < 0).length
  const over    = rows.filter(r => r.variance > 0).length
  addTitleBand(ws, 'Stocktake Variance Report',
    `${meta.resortName || 'Outrigger Maafushivaru Resort'}  ·  ${meta.sessionLabel || ''}  ·  ${meta.date || new Date().toLocaleDateString()}  ·  ${rows.length} item(s) · ${matched} match / ${short} short / ${over} over`, headers.length)
  styleHeaderRow(ws, 4, headers)

  rows.forEach((r, idx) => {
    const rowIdx = idx + 5
    const v = Number(r.variance) || 0
    const col = varianceColor(v)
    const result = v === 0 ? 'Match' : v > 0 ? `Surplus +${v}` : `Shortage ${v}`
    const vals = [idx + 1, r.part_number || '—', r.item_name || '', r.unit || '',
      Number(r.system_qty) || 0, Number(r.counted_qty) || 0,
      v, (r.variance_pct == null ? '—' : `${r.variance_pct}%`),
      (r.variance_value == null ? '—' : Number(r.variance_value)), result]
    const row = ws.getRow(rowIdx)
    vals.forEach((val, i) => {
      const c = row.getCell(i + 1)
      c.value = val; c.border = border()
      c.font = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } }
      c.alignment = { vertical: 'middle', horizontal: [0, 3, 4, 5, 6, 7, 8].includes(i) ? 'center' : 'left', indent: [0, 3, 4, 5, 6, 7, 8].includes(i) ? 0 : 1 }
      if (idx % 2 === 1) c.fill = fill(GREY_ROW)
    })
    ;[7, 10].forEach(ci => {
      const c = row.getCell(ci)
      c.fill = fill(col.bg)
      c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: col.txt } }
    })
    row.height = 19
  })

  // Footer note
  const noteRow = rows.length + 6
  ws.mergeCells(noteRow, 1, noteRow, headers.length)
  const note = ws.getCell(noteRow, 1)
  note.value = 'Variance = Counted − System. Negative = shortage (red), positive = surplus (blue). Generated by the Inventory Management System.'
  note.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF94A3B8' } }

  const buf = await wb.xlsx.writeBuffer()
  downloadBuffer(buf, meta.filename || `Stocktake_Variance_${new Date().toISOString().split('T')[0]}.xlsx`)
}

// ═══════════════════════════════════════════════════════════════════════════
// 5) WASTE / DISPOSAL LOG  — coloured, formatted export with a summary band.
//   rows: waste_log records joined with items(name, part_number, unit, stores)
//   meta: { resortName, dateFrom, dateTo }
// ═══════════════════════════════════════════════════════════════════════════
const WASTE_REASON_XLSX = {
  Expired:          { bg: 'FFFFE4E6', txt: 'FFB91C1C' },
  Damaged:          { bg: 'FFFFEDD5', txt: 'FFC2410C' },
  Contamination:    { bg: 'FFF3E8FF', txt: 'FF7E22CE' },
  'Over-Production': { bg: 'FFFEF9C3', txt: 'FF854D0E' },
  Other:            { bg: 'FFF1F5F9', txt: 'FF334155' },
}

export async function exportWasteExcel(rows, meta = {}) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Outrigger Maafushivaru Inventory'
  wb.created = new Date()
  const ws = wb.addWorksheet('Waste Log', {
    views: [{ state: 'frozen', ySplit: 5 }],
    pageSetup: { fitToPage: true, fitToWidth: 1, orientation: 'landscape' },
  })

  const headers = ['#', 'Date', 'Part #', 'Item Name', 'Store', 'Reason', 'Qty', 'Unit', 'Unit Cost', 'Total Cost', 'Logged By', 'Notes']
  ws.columns = [
    { width: 5 }, { width: 12 }, { width: 13 }, { width: 34 }, { width: 18 }, { width: 15 },
    { width: 9 }, { width: 8 }, { width: 11 }, { width: 12 }, { width: 16 }, { width: 30 },
  ]

  const totalQty  = rows.reduce((s, w) => s + Number(w.quantity || 0), 0)
  const totalCost = rows.reduce((s, w) => s + Number(w.quantity || 0) * Number(w.unit_cost || 0), 0)
  const range = meta.dateFrom && meta.dateTo ? `${meta.dateFrom} → ${meta.dateTo}` : 'All dates'

  addTitleBand(ws, 'Waste / Disposal Log',
    `${meta.resortName || 'Outrigger Maafushivaru Resort'}  ·  ${range}  ·  ${rows.length} record(s)  ·  ${totalQty.toFixed(1)} units  ·  Est. value $${totalCost.toFixed(2)}`,
    headers.length)

  // Reason summary band (row 3)
  const byReason = {}
  rows.forEach(w => { byReason[w.reason] = (byReason[w.reason] || 0) + 1 })
  ws.mergeCells(3, 1, 3, headers.length)
  const sb = ws.getCell(3, 1)
  sb.value = Object.entries(byReason).map(([k, v]) => `${k}: ${v}`).join('    ·    ') || 'No records'
  sb.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF475569' } }
  sb.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  ws.getRow(3).height = 18

  styleHeaderRow(ws, 5, headers)

  rows.forEach((w, idx) => {
    const rowIdx = idx + 6
    const row = ws.getRow(rowIdx)
    const rc = WASTE_REASON_XLSX[w.reason] || WASTE_REASON_XLSX.Other
    const cost = Number(w.quantity || 0) * Number(w.unit_cost || 0)
    const vals = [
      idx + 1, w.date || '', w.items?.part_number || '', w.items?.name || '',
      w.items?.stores?.name || '', w.reason || '', Number(w.quantity) || 0, w.items?.unit || '',
      Number(w.unit_cost) || 0, cost, w.logged_by || '', w.notes || '',
    ]
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1)
      c.value = v
      c.font = { name: 'Calibri', size: 10 }
      c.border = border()
      c.alignment = { vertical: 'middle', horizontal: (i === 0 || (i >= 6 && i <= 9)) ? 'center' : 'left', wrapText: i === 3 || i === 11 }
      c.fill = fill(idx % 2 ? GREY_ROW : WHITE)
      if (i === 5) { // Reason chip
        c.fill = fill(rc.bg)
        c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: rc.txt } }
        c.alignment = { vertical: 'middle', horizontal: 'center' }
      }
      if (i === 8 || i === 9) c.numFmt = '#,##0.00'
    })
    row.height = 18
  })

  // Totals row
  const tr = ws.getRow(rows.length + 6)
  tr.getCell(6).value = 'TOTAL'
  tr.getCell(7).value = totalQty
  tr.getCell(10).value = totalCost
  ;[6, 7, 10].forEach(ci => {
    const c = tr.getCell(ci)
    c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: WHITE } }
    c.fill = fill(BRAND_DARK)
    c.alignment = { vertical: 'middle', horizontal: ci === 6 ? 'right' : 'center' }
    if (ci === 10) c.numFmt = '#,##0.00'
  })
  tr.height = 20

  const buffer = await wb.xlsx.writeBuffer()
  downloadBuffer(buffer, `Waste_Log_${meta.dateFrom || 'all'}_${meta.dateTo || ''}.xlsx`)
}
