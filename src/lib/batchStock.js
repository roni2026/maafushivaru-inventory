// ─────────────────────────────────────────────────────────────
// batchStock.js — add stock to an item as one or more (quantity,
// expiry date) batches.
//
// Rules:
//  • A batch whose expiry date is still in the future (or today)
//    is recorded in item_batches AND added to items.current_stock.
//  • A batch whose expiry date has ALREADY passed is never added
//    to inventory — it's logged straight to waste_log instead
//    (reason "Expired"), using the signed-in user's name.
// ─────────────────────────────────────────────────────────────
import { supabase } from './supabase'
import { daysUntil } from './expiry'
import { getCurrentUserName } from './profile'

// lines: [{ quantity, expiry_date, batch_code?, note? }]
export async function addStockBatches(item, lines, { loggedBy } = {}) {
  const who = loggedBy || await getCurrentUserName()
  const today = new Date().toISOString().split('T')[0]

  const toAdd = []     // batches to insert into item_batches
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

  // 2) Still-good lines → item_batches + bump current_stock.
  if (toAdd.length) {
    const batchRows = toAdd.map(b => ({
      item_id: item.id,
      expiry_date: b.expiry_date || null,
      quantity: b.quantity,
      batch_code: b.batch_code || null,
      note: b.note || null,
    }))
    const { error: batchErr } = await supabase.from('item_batches').insert(batchRows)
    if (batchErr) throw batchErr

    const newStock = Number(item.current_stock || 0) + addQty
    const { error: stockErr } = await supabase.from('items').update({ current_stock: newStock }).eq('id', item.id)
    if (stockErr) throw stockErr

    await supabase.from('stock_updates').insert({
      item_id: item.id,
      date: today,
      quantity_change: addQty,
      new_quantity: newStock,
      updated_by: who,
      note: `Added ${toAdd.length} batch(es) with expiry`,
    })
  }

  return {
    addedQty: addQty,
    addedBatches: toAdd.length,
    wastedQty: toWaste.reduce((s, w) => s + w.quantity, 0),
    wastedBatches: toWaste.length,
  }
}
