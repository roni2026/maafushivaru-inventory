// ────────────────────────────────────────────────────────────────────────────
// boatNoteReport.js — professional, categorised Boat-Note receiving reports.
//
//   • buildBoatNoteWorkbook(note, lines, opts) → ExcelJS Buffer (categorised:
//     Received first, then Damaged, Wrong Item, Not Arrived, Pending). Includes
//     a summary band and a second "All Items" sheet with AutoFilter so the whole
//     list can be re-sorted / filtered inside Excel.
//   • exportBoatNoteExcel(...)   → build + trigger a browser download.
//   • printBoatNoteReport(...)   → open a print-ready window (print or Save-as-PDF).
//
// The line "status" values used across the app:
//   received · damaged · wrong_item · not_arrived · pending (nothing set yet)
// ────────────────────────────────────────────────────────────────────────────

const BRAND      = 'FF00AEEF'
const BRAND_DARK = 'FF0090C5'
const WHITE      = 'FFFFFFFF'

// Category order + presentation colours.
export const CATEGORIES = [
  { key: 'received',    label: 'Received',    xlsx: 'FF15803D', hex: '#15803d', bg: 'FFDCFCE7' },
  { key: 'damaged',     label: 'Damaged',     xlsx: 'FFB91C1C', hex: '#b91c1c', bg: 'FFFFE4E6' },
  { key: 'wrong_item',  label: 'Wrong Item',  xlsx: 'FFEA580C', hex: '#ea580c', bg: 'FFFFEDD5' },
  { key: 'not_arrived', label: 'Not Arrived', xlsx: 'FFDC2626', hex: '#dc2626', bg: 'FFFEE2E2' },
  { key: 'pending',     label: 'Pending',     xlsx: 'FFCA8A04', hex: '#ca8a04', bg: 'FFFEF9C3' },
]

const HEADERS = ['#', 'Code', 'Product', 'Dept', 'Unit', 'Ordered', 'Received', 'Expiry', 'Supplier', 'PO', 'Note']

function rowValues(it) {
  return [
    it.line_no ?? '',
    it.part_number || '',
    it.product_name || '',
    it.department || '',
    it.unit || '',
    Number(it.ordered_qty) || 0,
    it.received_qty ?? '',
    it.expiry_date || '',
    it.supplier || '',
    it.po_number || '',
    it.note || '',
  ]
}

// Bucket lines into categories (unknown/skipped → pending).
function bucketize(lines, sortBy = 'line_no', sortDir = 'asc') {
  const map = {}
  CATEGORIES.forEach(c => { map[c.key] = [] })
  for (const l of lines) {
    const k = map[l.status] ? l.status : 'pending'
    map[k].push(l)
  }
  const cmp = (a, b) => {
    let av = a[sortBy], bv = b[sortBy]
    if (sortBy === 'ordered_qty' || sortBy === 'received_qty' || sortBy === 'line_no') {
      av = Number(av) || 0; bv = Number(bv) || 0
    } else { av = String(av || '').toLowerCase(); bv = String(bv || '').toLowerCase() }
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  }
  Object.values(map).forEach(arr => arr.sort(cmp))
  return map
}

// ── ExcelJS workbook ────────────────────────────────────────────────────────
export async function buildBoatNoteWorkbook(note, lines, { sortBy = 'line_no', sortDir = 'asc' } = {}) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Outrigger Maafushivaru Inventory'
  wb.created = new Date()

  const fill = (c) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: c } })
  const thin = { style: 'thin', color: { argb: 'FFD7DEE6' } }
  const border = { top: thin, left: thin, bottom: thin, right: thin }
  const buckets = bucketize(lines, sortBy, sortDir)
  const lastCol = HEADERS.length

  // ---- Sheet 1: categorised presentation ----
  const ws = wb.addWorksheet('Boat Note Report', { views: [{ showGridLines: false }] })
  const label = note.label || note.note_date || 'Boat Note'

  ws.mergeCells(1, 1, 1, lastCol)
  const t = ws.getCell(1, 1)
  t.value = `Boat Note Receiving Report — ${label}`
  t.font = { name: 'Calibri', size: 18, bold: true, color: { argb: WHITE } }
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  t.fill = fill(BRAND); ws.getRow(1).height = 32

  ws.mergeCells(2, 1, 2, lastCol)
  const s = ws.getCell(2, 1)
  const counts = CATEGORIES.map(c => `${c.label}: ${buckets[c.key].length}`).join('   ·   ')
  s.value = `Date ${note.note_date || '—'}   ·   Total lines ${lines.length}   ·   ${counts}   ·   Generated ${new Date().toLocaleString('en-GB')}`
  s.font = { name: 'Calibri', size: 10, color: { argb: WHITE } }
  s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  s.fill = fill(BRAND_DARK); ws.getRow(2).height = 20

  let r = 4
  for (const cat of CATEGORIES) {
    const items = buckets[cat.key]
    if (!items.length) continue
    // section banner
    ws.mergeCells(r, 1, r, lastCol)
    const b = ws.getCell(r, 1)
    b.value = `${cat.label.toUpperCase()}  (${items.length})`
    b.font = { name: 'Calibri', size: 12, bold: true, color: { argb: cat.xlsx } }
    b.fill = fill(cat.bg)
    b.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    ws.getRow(r).height = 22
    r++
    // header
    const hr = ws.getRow(r)
    HEADERS.forEach((h, i) => {
      const c = hr.getCell(i + 1)
      c.value = h
      c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: WHITE } }
      c.fill = fill('FF1E293B')
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      c.border = border
    })
    hr.height = 22
    r++
    // rows
    items.forEach((it, idx) => {
      const row = ws.getRow(r)
      rowValues(it).forEach((v, i) => {
        const c = row.getCell(i + 1)
        c.value = v
        c.font = { name: 'Calibri', size: 10 }
        c.alignment = { vertical: 'middle', horizontal: i >= 5 && i <= 6 ? 'center' : 'left', wrapText: i === 2 || i === 10 }
        c.fill = fill(idx % 2 ? 'FFF4F7FA' : WHITE)
        c.border = border
      })
      r++
    })
    r++ // gap
  }

  ws.columns = [
    { width: 5 }, { width: 12 }, { width: 34 }, { width: 12 }, { width: 8 },
    { width: 10 }, { width: 10 }, { width: 12 }, { width: 20 }, { width: 12 }, { width: 26 },
  ]

  // ---- Sheet 2: flat list with AutoFilter (fully sortable in Excel) ----
  const ws2 = wb.addWorksheet('All Items')
  const flatHeaders = ['Status', ...HEADERS]
  const hr2 = ws2.getRow(1)
  flatHeaders.forEach((h, i) => {
    const c = hr2.getCell(i + 1)
    c.value = h
    c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: WHITE } }
    c.fill = fill('FF1E293B')
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    c.border = border
  })
  hr2.height = 22
  let rr = 2
  for (const cat of CATEGORIES) {
    for (const it of buckets[cat.key]) {
      const row = ws2.getRow(rr)
      const vals = [cat.label, ...rowValues(it)]
      vals.forEach((v, i) => {
        const c = row.getCell(i + 1)
        c.value = v
        c.font = { name: 'Calibri', size: 10 }
        c.border = border
      })
      rr++
    }
  }
  ws2.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rr - 1), column: flatHeaders.length } }
  ws2.columns = [{ width: 12 }, { width: 5 }, { width: 12 }, { width: 34 }, { width: 12 }, { width: 8 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 20 }, { width: 12 }, { width: 26 }]
  ws2.views = [{ state: 'frozen', ySplit: 1 }]

  return wb.xlsx.writeBuffer()
}

export function reportFileName(note, ext = 'xlsx') {
  const label = (note.label || note.note_date || 'boat-note').replace(/[^\w-]+/g, '_')
  return `BoatNote_Report_${label}.${ext}`
}

export async function exportBoatNoteExcel(note, lines, opts) {
  const buffer = await buildBoatNoteWorkbook(note, lines, opts)
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = reportFileName(note, 'xlsx')
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

// Base64 (no data: prefix) of the workbook — for email attachments (Brevo).
export async function boatNoteExcelBase64(note, lines, opts) {
  const buffer = await buildBoatNoteWorkbook(note, lines, opts)
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

// ── Print / Save-as-PDF ───────────────────────────────────────────────────
export function buildBoatNoteHtml(note, lines, { sortBy = 'line_no', sortDir = 'asc' } = {}) {
  const buckets = bucketize(lines, sortBy, sortDir)
  const label = note.label || note.note_date || 'Boat Note'
  const esc = (v) => String(v ?? '').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]))

  const section = (cat) => {
    const items = buckets[cat.key]
    if (!items.length) return ''
    const rows = items.map((it, i) => `
      <tr style="background:${i % 2 ? '#f8fafc' : '#fff'}">
        <td>${esc(it.line_no)}</td>
        <td style="font-family:monospace">${esc(it.part_number)}</td>
        <td><strong>${esc(it.product_name)}</strong></td>
        <td>${esc(it.department)}</td>
        <td>${esc(it.unit)}</td>
        <td style="text-align:center">${esc(it.ordered_qty)}</td>
        <td style="text-align:center">${esc(it.received_qty ?? '—')}</td>
        <td>${esc(it.expiry_date || '—')}</td>
        <td>${esc(it.supplier)}</td>
        <td>${esc(it.note || '')}</td>
      </tr>`).join('')
    return `
      <h2 style="margin:22px 0 6px;color:${cat.hex};font-size:15px;border-bottom:2px solid ${cat.hex};padding-bottom:4px">
        ${cat.label} <span style="color:#94a3b8;font-weight:400">(${items.length})</span>
      </h2>
      <table>
        <thead><tr>
          <th>#</th><th>Code</th><th>Product</th><th>Dept</th><th>Unit</th>
          <th>Ord.</th><th>Rcvd</th><th>Expiry</th><th>Supplier</th><th>Note</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`
  }

  const counts = CATEGORIES.map(c => `${c.label}: <strong>${buckets[c.key].length}</strong>`).join(' &nbsp;·&nbsp; ')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
    <title>${reportFileName(note, 'pdf')}</title>
    <style>
      *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;margin:24px;font-size:12px}
      .band{background:#00AEEF;color:#fff;padding:14px 18px;border-radius:8px}
      .band h1{margin:0;font-size:18px} .band p{margin:4px 0 0;font-size:11px;opacity:.95}
      table{width:100%;border-collapse:collapse;margin-top:4px}
      th{background:#1e293b;color:#fff;font-size:10px;padding:6px 8px;text-align:left}
      td{border:1px solid #e2e8f0;padding:5px 8px;font-size:11px;vertical-align:top}
      @media print{body{margin:8mm} h2{page-break-after:avoid} tr{page-break-inside:avoid}}
    </style></head>
    <body>
      <div class="band">
        <h1>Boat Note Receiving Report — ${esc(label)}</h1>
        <p>Date ${esc(note.note_date || '—')} · Total lines ${lines.length} · Generated ${new Date().toLocaleString('en-GB')}</p>
        <p>${counts}</p>
      </div>
      ${CATEGORIES.map(section).join('')}
    </body></html>`
}

export function printBoatNoteReport(note, lines, opts) {
  const html = buildBoatNoteHtml(note, lines, opts)
  printHtmlDocument(html)
}

// Generic: open a print window for any full HTML document (print or Save-as-PDF).
export function printHtmlDocument(html) {
  const w = window.open('', '_blank')
  if (!w) { alert('Please allow pop-ups to print / save as PDF.'); return }
  w.document.open(); w.document.write(html); w.document.close()
  w.focus()
  setTimeout(() => { w.print() }, 400)
}
