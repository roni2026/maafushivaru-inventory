// In-app notification helper.
//
// Notifications are now a SHARED, PERSISTED table (`notifications`, see
// supabase/migrations/022_unified_batch_expiry.sql) instead of being
// recomputed from scratch in the browser every time. `generate_due_notifications()`
// (a DB RPC) is the single place that decides which alerts should exist --
// it opens exactly one row per condition (low stock / out of stock /
// expiring / expired / boat note pending), scheduled for the configured
// notification_time, and resolves rows whose condition has cleared. Both
// the website and Android app call the same RPC, so the exact same alerts
// show up in both places, never duplicated.
import { supabase } from './supabase'

const TYPE_LINK = {
  low_stock: '/inventory',
  out_of_stock: '/inventory',
  expiring: '/expiry',
  expired: '/expiry',
  boat_note_pending: '/boat-note',
}

export async function fetchNotifications() {
  // Recompute which alerts should currently be open (idempotent, dedup'd by
  // the DB) before reading them back.
  try { await supabase.rpc('generate_due_notifications') } catch { /* best-effort */ }

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error

  return (data || []).map(n => ({
    id: n.id,
    type: n.type,
    severity: n.severity,
    title: n.title,
    sub: n.body,
    link: n.link || TYPE_LINK[n.type] || '/inventory',
    notify_at: n.notify_at,
    sent_at: n.sent_at,
  }))
}

const KEY = 'notif_read_v1'
export function getReadIds() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')) }
  catch { return new Set() }
}
export function saveReadIds(ids) {
  try { localStorage.setItem(KEY, JSON.stringify([...ids])) }
  catch {}
}
