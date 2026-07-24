// ─────────────────────────────────────────────────────────────────────────────
// boatNoteHistory.js — per-boat-note change history (audit trail).
//
// Every weekly upload and every later change to a boat note is appended to the
// `boat_note_events` table so, when you open a boat note's history, you can see
// exactly what was originally there and what was updated afterwards (and by whom).
//
// Best-effort: logging never throws — a failed audit write must not block the
// real action.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from './supabase'
import { currentActor } from './activity'

// Pretty label for an event type (used in the history timeline).
export function boatEventLabel(type) {
  const map = {
    uploaded:     'Uploaded',
    received:     'Received',
    not_arrived:  'Not arrived',
    wrong_item:   'Wrong item',
    damaged:      'Damaged',
    short:        'Short',
    item_updated: 'Item updated',
    item_removed: 'Item removed',
    resolved:     'Resolved',
    note_updated: 'Note updated', arrived: 'Arrived', increased: 'Increased',
  }
  return map[type] || type
}

// Colour hint for the badge.
export function boatEventTone(type) {
  const map = {
    uploaded: 'teal', received: 'green', not_arrived: 'red', wrong_item: 'orange',
    damaged: 'red', short: 'yellow', item_updated: 'blue', item_removed: 'gray',
    resolved: 'green', note_updated: 'blue', arrived: 'teal', increased: 'green',
  }
  return map[type] || 'gray'
}

// Log a single boat-note event. Never throws.
export async function logBoatNoteEvent(boatNoteId, eventType, {
  boatNoteItemId = null, detail = null, partNumber = null, productName = null,
  department = null, qty = null, snapshot = null, actor = null,
} = {}) {
  if (!boatNoteId) return
  try {
    const who = actor || (await currentActor())
    await supabase.from('boat_note_events').insert({
      boat_note_id: boatNoteId,
      boat_note_item_id: boatNoteItemId,
      event_type: eventType,
      detail,
      part_number: partNumber,
      product_name: productName,
      department,
      qty: (qty === '' || qty === undefined) ? null : qty,
      snapshot,
      actor: who,
    })
  } catch {
    /* non-critical — table may not exist yet on an un-migrated DB */
  }
}

// Fetch a boat note's full history, newest first.
export async function fetchBoatNoteEvents(boatNoteId, limit = 200) {
  if (!boatNoteId) return []
  const { data, error } = await supabase
    .from('boat_note_events')
    .select('*')
    .eq('boat_note_id', boatNoteId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return []
  return data || []
}
