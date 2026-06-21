// ────────────────────────────────────────────────────────────────────────────
// expiry.js — shared helpers for expiry tracking, thresholds & batches
// ────────────────────────────────────────────────────────────────────────────

export const EXPIRY_RANGE_DAYS = 120   // 4-month look-ahead window

export function daysUntil(d) {
  if (!d) return null
  const exp = new Date(d); exp.setHours(0, 0, 0, 0)
  const now = new Date(); now.setHours(0, 0, 0, 0)
  return Math.ceil((exp - now) / 86400000)
}

// The reminder thresholds the user can toggle, in send-priority order.
export const EXPIRY_THRESHOLDS = [
  { key: '3m',    label: '3 months before', days: 90 },
  { key: '2m',    label: '2 months before', days: 60 },
  { key: '1m',    label: '1 month before',  days: 30 },
  { key: '15d',   label: '15 days before',  days: 15 },
  { key: '7d',    label: '7 days before',   days: 7  },
  { key: 'after', label: 'After it expires', days: -1 },
]

export const EXPIRY_SETTING_KEYS = {
  '3m': 'expiry_email_3m',
  '2m': 'expiry_email_2m',
  '1m': 'expiry_email_1m',
  '15d': 'expiry_email_15d',
  '7d': 'expiry_email_7d',
  'after': 'expiry_email_after',
}

// Which single threshold bucket does an item with `days` left fall into?
// Returns the *tightest* applicable bucket key, or null if outside the window.
export function thresholdForDays(days) {
  if (days === null) return null
  if (days < 0) return 'after'
  if (days <= 7) return '7d'
  if (days <= 15) return '15d'
  if (days <= 30) return '1m'
  if (days <= 60) return '2m'
  if (days <= 90) return '3m'
  return null
}

export function expiryColorClass(days) {
  if (days === null) return 'text-slate-400'
  if (days < 0) return 'text-red-400'
  if (days <= 7) return 'text-red-400'
  if (days <= 15) return 'text-orange-400'
  if (days <= 30) return 'text-yellow-400'
  if (days <= 60) return 'text-blue-400'
  return 'text-emerald-400'
}

export function expiryRowTint(days) {
  if (days === null) return ''
  if (days < 0 || days <= 7) return 'border-l-4 border-l-red-500'
  if (days <= 15) return 'border-l-4 border-l-orange-500'
  if (days <= 30) return 'border-l-4 border-l-yellow-500'
  if (days <= 60) return 'border-l-4 border-l-blue-500'
  return 'border-l-4 border-l-emerald-600'
}

// Expand items + their batches into individual expiry rows.
// Each item contributes:
//   • one row per batch that has an expiry_date (qty = batch.quantity)
//   • a fallback row from item.expiry_date when the item has no batches
export function buildExpiryRows(items, batchesByItem = {}, rangeDays = EXPIRY_RANGE_DAYS) {
  const rows = []
  for (const it of items) {
    const batches = (batchesByItem[it.id] || []).filter(b => b.expiry_date)
    if (batches.length) {
      for (const b of batches) {
        const d = daysUntil(b.expiry_date)
        if (d === null || d > rangeDays) continue
        rows.push({
          key: `b-${b.id}`,
          item_id: it.id,
          batch_id: b.id,
          part_number: it.part_number,
          name: it.name,
          store: it.stores?.name || '',
          category: it.stores?.category || '',
          unit: it.unit,
          current_stock: b.quantity,
          expiry_date: b.expiry_date,
          batch_code: b.batch_code || '',
          days: d,
          source: 'batch',
        })
      }
    } else if (it.expiry_date) {
      const d = daysUntil(it.expiry_date)
      if (d === null || d > rangeDays) continue
      rows.push({
        key: `i-${it.id}`,
        item_id: it.id,
        batch_id: null,
        part_number: it.part_number,
        name: it.name,
        store: it.stores?.name || '',
        category: it.stores?.category || '',
        unit: it.unit,
        current_stock: it.current_stock,
        expiry_date: it.expiry_date,
        batch_code: '',
        days: d,
        source: 'item',
      })
    }
  }
  // Shortest → longest time to expiry
  rows.sort((a, b) => a.days - b.days)
  return rows
}
