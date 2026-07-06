// ────────────────────────────────────────────────────────────────
// batchStock.js — the ONLY way stock is added/edited/removed via batches.
//
// Every write goes through the shared Postgres RPCs (upsert_item_batch /
// delete_item_batch) so Website + Android always compute the exact same
// result. items.current_stock is recalculated by a DB trigger as
// SUM(remaining_quantity) — this file never increments current_stock by
// hand, which is what used to cause stock to double-count (e.g. 50 + 60
// batches = 110 instead of the correct 60).
//
// Rules preserved from the original feature:
//  • A batch whose expiry date is still in the future (or today) is
//    recorded in item_batches (and inventory is recalculated).
//  • A batch whose expiry date has ALREADY passed is never added to
//    inventory — it's logged straight to waste_log instead
//    (reason "Expired"), using the signed-in user's name.
// ────────────────────────────────────────────────────────────────
import { supabase } from './supabase'
import { daysUntil } from './expiry'
import { getCurrentUserName } from './profile'

// lines: [{ quantity, expiry_date, batch_code?, note? }]
export async function addStockBatches(item, lines, { loggedBy } = {}) {
  const who = loggedBy || await getCurrentUserName()
  const today = new Date().toISOString().split('T')[0]

  const toAdd = []     // batches to create via RPC
  const toWaste = []   // batches that are already expired
  let addQty = 0

  for (const line of lines) {
    const qty = Number(line.quantity)
    if (!qty || qty <= 0) continue
    const days = line.expiry_date ? daysUntil(line.expiry_date) : null
    if (days !== null && days < 0) {
      toWaste.push({ ...line, quantity: qty, days })
    } else {
      toAdd.push({ ...line, quantity: qty })
      addQty += qty
    }
  }

  if (!toAdd.length && !toWaste.length) {
    throw new Error('Enter at least one quantity')
  }

  // 1) Already-expired lines → straight to the waste log, never added to stock.
  if (toWaste.length) {
    const wasteRows = toWaste.map(w => ({
      item_id: item.id,
      quantity: w.quantity,
      reason: 'Expired',
      date: today,
      logged_by: who,
      notes: w.note || `Expired batch (exp ${w.expiry_date}) — not added to inventory`,
      unit_cost: Number(item.unit_cost || 0),
    }))
    const { error: wasteErr } = await supabase.from('waste_log').insert(wasteRows)
    if (wasteErr) throw wasteErr
  }

  // 2) Still-good lines → one upsert_item_batch RPC call each. The DB
  //    trigger recalculates items.current_stock = SUM(remaining_quantity)
  //    automatically — no manual math here.
  if (toAdd.length) {
    for (const b of toAdd) {
      const { error } = await supabase.rpc('upsert_item_batch', {
        p_batch_id: null,
        p_item_id: item.id,
        p_expiry_date: b.expiry_date || null,
        p_quantity: b.quantity,
        p_batch_code: b.batch_code || null,
        p_note: b.note || null,
      })
      if (error) throw error
    }

    try {
      await supabase.from('stock_updates').insert({
        item_id: item.id,
        date: today,
        quantity_change: addQty,
        new_quantity: null, // informational only — current_stock is DB-derived now
        updated_by: who,
        note: `Added ${toAdd.length} batch(es) with expiry`,
      })
    } catch { /* best-effort audit row */ }
  }

  return {
    addedQty: addQty,
    addedBatches: toAdd.length,
    wastedQty: toWaste.reduce((s, w) => s + w.quantity, 0),
    wastedBatches: toWaste.length,
  }
}

export async function fetchItemBatches(itemId) {
  const { data, error } = await supabase
    .from('item_batches').select('*').eq('item_id', itemId)
    .order('expiry_date', { ascending: true, nullsFirst: false })
  if (error) throw error
  return data || []
}

// Add OR edit a single batch (batchId null = create). Editing quantity only
// applies the delta to remaining_quantity, so already-issued portions of a
// batch are respected (see 022_unified_batch_expiry.sql for the exact rule).
export async function upsertItemBatch({ batchId = null, itemId, expiryDate, quantity, batchCode, note }) {
  const { data, error } = await supabase.rpc('upsert_item_batch', {
    p_batch_id: batchId,
    p_item_id: itemId,
    p_expiry_date: expiryDate || null,
    p_quantity: Number(quantity),
    p_batch_code: batchCode || null,
    p_note: note || null,
  })
  if (error) throw error
  return data
}

export async function deleteItemBatch(batchId) {
  const { error } = await supabase.rpc('delete_item_batch', { p_batch_id: batchId })
  if (error) throw error
}
