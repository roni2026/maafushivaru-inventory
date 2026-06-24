// ─────────────────────────────────────────────────────────────────────────────
// requisition.js — smart parser for OCR'd Birchstreet REQUISITION printouts.
//
// A requisition page looks like:
//
//   REQ NUMBER : REQ-MAM-000035237        Status: New
//   Required Delivery Date : 06/24/2026    REQ Date: 06/23/2026 22:20:40
//   REQ Type : Storeroom                   Department: MAM EDGEWATER
//   Purchase type : Food                   Source Location: MAM STORE MAIN- FOOD
//                                          Destination Location: MAM EDGEWATER BAR
//   # Part #            Product            Product Desc.        Qty UOM  Price   Extension
//   1 000000000013960   FROZEN MANGO JUICE 1410.025021/8650000  3.00 CAN $83.84 $251.53
//
// We key every line off its PART NUMBER (the long zero-padded number = the item
// code / item id). That's the most reliable signal, so even when OCR garbles the
// product text the line still matches an inventory item. Qty is best-guessed and
// the user confirms/edits it. Multiple requisitions in one scan are split by the
// "REQ NUMBER" marker so each keeps its own header + line numbering (1,2,3…).
// ─────────────────────────────────────────────────────────────────────────────

const KNOWN_UOM = ['EA', 'CAN', 'CS', 'BTL', 'KG', 'KGS', 'LTR', 'LIT', 'PKT', 'BOX',
  'TIN', 'BAG', 'CTN', 'PCS', 'PC', 'ROLL', 'RL', 'PQ', 'TUB', 'MTR', 'M', 'GAL', 'DOZ']

const cleanCode = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '') || ''

// Header field extractor — tolerant of OCR spacing / colon variations.
function grabField(text, labels) {
  for (const label of labels) {
    const re = new RegExp(label + '\\s*[:\\-]?\\s*([^\\n]+)', 'i')
    const m = text.match(re)
    if (m) return m[1].trim().replace(/\s{2,}.*$/, '').trim()
  }
  return ''
}

function parseHeader(block) {
  const reqNo = (block.match(/REQ\s*NUMBER\s*[:\-]?\s*(REQ[-\s]?MAM[-\s]?\d+)/i) ||
                 block.match(/(REQ[-\s]?MAM[-\s]?\d+)/i) || [])[1] || ''
  // Birchstreet prints US-style mm/dd/yyyy. Build a SAFE ISO date and reject
  // impossible values (month > 12 / day > 31) so we never feed Postgres a
  // garbage date like "2026-23-06" which throws "date/time field value out of range".
  const toIso = (d) => {
    const m = String(d).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (!m) return ''
    let mm = parseInt(m[1], 10)   // month (mm/dd/yyyy)
    let dd = parseInt(m[2], 10)   // day
    const yyyy = m[3]
    // If the first field is clearly a day (>12) and the second is a valid month,
    // the source was dd/mm/yyyy — swap so we still produce a valid date.
    if (mm > 12 && dd <= 12) { const t = mm; mm = dd; dd = t }
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return ''
    return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  }
  return {
    req_number: reqNo.replace(/\s+/g, ''),
    required_delivery_date: toIso(grabField(block, ['Required Delivery Date'])),
    req_date: toIso(grabField(block, ['REQ Date'])),
    req_type: grabField(block, ['REQ Type']),
    purchase_type: grabField(block, ['Purchase type']),
    requestor: grabField(block, ['Requestor']),
    title: grabField(block, ['Title']),
    department: grabField(block, ['Department']),
    source_location: grabField(block, ['Source Location']),
    destination_location: grabField(block, ['Destination Location']),
    subject: grabField(block, ['Subject']),
  }
}

// Parse a single item line. Returns null if it isn't an item row.
// Header / metadata lines that must NEVER be treated as item rows. The REQ
// NUMBER line ("REQ NUMBER : REQ-MAM-000035237  Status: New") in particular was
// being parsed as an item because the zero-padded number looks like a part code.
const HEADER_LINE_RE = new RegExp(
  '(REQ\\s*NUMBER|REQ[-\\s]?MAM[-\\s]?\\d|\\bStatus\\s*[:\\-]|Required\\s*Delivery|' +
  'REQ\\s*Date|REQ\\s*Type|Purchase\\s*type|Source\\s*Location|Destination\\s*Location|' +
  '\\bRequestor\\b|\\bDepartment\\s*[:\\-]|\\bTitle\\s*[:\\-]|\\bSubject\\s*[:\\-]|' +
  'Product\\s*Desc|\\bUOM\\b\\s*Price|\\bExtension\\b)', 'i')

function parseItemLine(line) {
  const trimmed = line.replace(/\s+/g, ' ').trim()
  if (trimmed.length < 6) return null

  // Skip requisition header / metadata / column-title lines outright.
  if (HEADER_LINE_RE.test(trimmed)) return null

  // leading line number
  const lnMatch = trimmed.match(/^(\d{1,3})\s+/)
  // part number: first run of >= 5 digits (the zero-padded item code)
  const partMatch = trimmed.match(/\b(\d{5,15})\b/)
  if (!partMatch) return null
  const partNumber = cleanCode(partMatch[1])
  if (!partNumber) return null

  // money tokens ($x.xx) → price + extension (last two)
  const money = [...trimmed.matchAll(/\$\s*(\d+(?:[.,]\d{1,4}))/g)].map(m => parseFloat(m[1].replace(',', '')))

  // PRIMARY: the real columns are "<qty> <UOM> $price $extension" at the tail.
  // Anchor on "<number> <letters> $" and take the LAST valid match — this avoids
  // false hits like "5LTR" buried inside a product name.
  let qty = null, uom = ''
  for (const m of trimmed.matchAll(/(\d+(?:\.\d+)?)\s*([A-Za-z]{1,4})\s*\$/g)) {
    const u = m[2].toUpperCase()
    if (KNOWN_UOM.includes(u)) { qty = parseFloat(m[1]); uom = u }   // last valid wins
  }
  // FALLBACK: standalone UOM token + first decimal
  if (qty == null) {
    for (const t of trimmed.split(' ')) {
      const up = t.replace(/[^A-Za-z]/g, '').toUpperCase()
      if (KNOWN_UOM.includes(up) && t.toUpperCase() === up) uom = up
    }
    const smalls = [...trimmed.matchAll(/\b(\d+\.\d{2})\b/g)].map(m => parseFloat(m[1]))
    qty = smalls.length ? smalls[0] : 1
  }
  const tokens = trimmed.split(' ')

  // product text = between the part number and the qty/uom region
  let rest = trimmed
  if (lnMatch) rest = rest.slice(lnMatch[0].length)
  rest = rest.replace(partMatch[1], ' ')
  // drop GL-code noise like 1410.025021 / 8650000
  rest = rest.replace(/\d{4}\.\d{6}\s*\/\s*\d{6,}/g, ' ')
  rest = rest.replace(/\$?\s*\d+(?:[.,]\d{2,4})/g, ' ')          // money & qty
  if (uom) rest = rest.replace(new RegExp('\\b' + uom + '\\b', 'i'), ' ')
  const product = rest.replace(/\s{2,}/g, ' ').trim()

  return {
    line_no: lnMatch ? parseInt(lnMatch[1], 10) : null,
    part_number: partNumber,
    product,
    qty,
    uom: uom || 'EA',
    price: money.length >= 2 ? money[money.length - 2] : (money[0] || 0),
    extension: money.length ? money[money.length - 1] : 0,
  }
}

// Build a quick lookup of inventory by cleaned part number + lowercase name.
function buildIndex(items) {
  const byCode = new Map()
  for (const it of items) byCode.set(cleanCode(it.part_number), it)
  return { byCode }
}
function matchItem(line, index, items) {
  let it = index.byCode.get(line.part_number)
  if (!it && line.product && line.product.length > 4) {
    const p = line.product.toLowerCase().slice(0, 10)
    it = items.find(i => i.name.toLowerCase().includes(p))
  }
  return it || null
}

// Main entry. Returns an array of { header, lines } — one per requisition found.
export function parseRequisitions(rawText, inventoryItems = []) {
  const index = buildIndex(inventoryItems)
  // split into requisition blocks on each "REQ NUMBER" marker
  const markers = [...rawText.matchAll(/REQ\s*NUMBER/gi)].map(m => m.index)
  const blocks = []
  if (markers.length <= 1) blocks.push(rawText)
  else {
    for (let i = 0; i < markers.length; i++)
      blocks.push(rawText.slice(markers[i], markers[i + 1] ?? rawText.length))
  }

  const out = []
  for (const block of blocks) {
    const header = parseHeader(block)
    const seen = new Set()
    const lines = []
    for (const raw of block.split('\n')) {
      const parsed = parseItemLine(raw)
      if (!parsed) continue
      if (seen.has(parsed.part_number)) continue
      seen.add(parsed.part_number)
      const matched = matchItem(parsed, index, inventoryItems)
      lines.push({
        id: Math.random().toString(36).slice(2),
        line_no: parsed.line_no,
        part_number: matched?.part_number || parsed.part_number,
        product: parsed.product,
        product_desc: parsed.product,
        qty: parsed.qty,
        uom: matched?.unit || parsed.uom,
        price: parsed.price,
        extension: parsed.extension,
        item_id: matched?.id || null,
        item_name: matched?.name || parsed.product,
        store: matched?.stores?.name || '',
        current_stock: matched?.current_stock ?? null,
        matched: !!matched,
        issued: true,                 // default: issued
        status: 'issued',
        reason: '',
        note: '',
      })
    }
    // keep line order by line_no when available
    lines.sort((a, b) => (a.line_no ?? 1e9) - (b.line_no ?? 1e9))
    if (lines.length || header.req_number) out.push({ header, lines })
  }
  return out
}

// Dropdown reasons for lines that were NOT issued.
export const NON_ISSUE_REASONS = [
  { value: 'wrong_code',         label: 'Wrong code' },
  { value: 'not_available',      label: 'Not available' },
  { value: 'no_longer_needed',   label: 'No longer needed' },
  { value: 'returned',           label: 'Returned' },
]
