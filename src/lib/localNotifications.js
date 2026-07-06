// ────────────────────────────────────────────────────────────────
// Local (browser / desktop) notifications.
//
// These run entirely on the device using the Web Notifications API and work
// ALONGSIDE the Brevo email reports — they are not a replacement. When
// enabled, the app raises a native desktop notification for due alerts
// (out of stock, low stock, expired / expiring soon, boat note pending)
// pulled from the SHARED `notifications` table (see notifications.js /
// 022_unified_batch_expiry.sql).
//
// Fixes the old behaviour where up to 13 alerts could fire in one burst the
// moment the page loaded, ignoring the configured send time: each row is now
// fired ONE AT A TIME (slightly staggered so they don't all pop at once),
// only once it's actually due (`notify_at <= now`, which the DB sets to the
// resort's configured notification_time), and is marked `sent_at` in the DB
// immediately after showing it so it can never fire twice — from this
// browser or any other device.
//
// The opt-in preference is still a per-device localStorage flag (whether
// THIS browser wants desktop notifications at all); the schedule + dedupe
// state now lives in the shared database, not localStorage.
// ────────────────────────────────────────────────────────────────
import { supabase } from './supabase'

const ENABLED_KEY = 'local_notifications_enabled'

export function localNotifsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

// The user has opted in (preference flag) — independent of OS permission state.
export function getLocalNotifPref() {
  try { return localStorage.getItem(ENABLED_KEY) === 'true' } catch { return false }
}

export function permissionState() {
  return localNotifsSupported() ? Notification.permission : 'unsupported'
}

// Truly active = opted in AND the browser has granted permission.
export function localNotifsEnabled() {
  return localNotifsSupported()
    && getLocalNotifPref()
    && Notification.permission === 'granted'
}

// Ask for permission and turn the preference on. Returns { ok, reason }.
export async function enableLocalNotifs() {
  if (!localNotifsSupported()) return { ok: false, reason: 'unsupported' }
  let perm = Notification.permission
  if (perm === 'default') {
    try { perm = await Notification.requestPermission() } catch { perm = 'denied' }
  }
  if (perm !== 'granted') {
    try { localStorage.setItem(ENABLED_KEY, 'false') } catch {}
    return { ok: false, reason: perm === 'denied' ? 'denied' : 'dismissed' }
  }
  try { localStorage.setItem(ENABLED_KEY, 'true') } catch {}
  return { ok: true }
}

export function disableLocalNotifs() {
  try { localStorage.setItem(ENABLED_KEY, 'false') } catch {}
}

// Fire a single test notification (used by the Settings "Send test" button).
export function sendTestNotification() {
  if (!localNotifsEnabled()) return false
  try {
    new Notification('🔔 Notifications enabled', {
      body: 'You will now get alerts individually, at your configured notification time.',
      tag: 'inv-test',
    })
    return true
  } catch { return false }
}

// Fetch every DUE, not-yet-sent notification from the shared table and fire
// each one individually as its own desktop notification, staggered a few
// hundred ms apart so the OS never has to render a burst of them at once.
// Each row is marked sent_at right after it fires (one RPC call per row,
// never a bulk update) so it is delivered exactly once across every device.
// Returns the number of notifications actually fired.
export async function syncLocalNotifications({ severities = ['critical', 'high', 'medium'] } = {}) {
  if (!localNotifsEnabled()) return 0

  const { data: due, error } = await supabase
    .from('notifications')
    .select('*')
    .is('sent_at', null)
    .is('resolved_at', null)
    .lte('notify_at', new Date().toISOString())
    .in('severity', severities)
    .order('notify_at', { ascending: true })
    .limit(20)
  if (error || !due?.length) return 0

  due.forEach((n, i) => {
    setTimeout(() => {
      try { new Notification(n.title, { body: n.body || '', tag: n.id }) } catch { /* ignore */ }
      // Mark this one notification as delivered -- individually, immediately
      // after showing it. Never a bulk "mark all sent" call.
      supabase.rpc('mark_notification_sent', { p_id: n.id }).catch(() => {})
    }, i * 600)
  })

  return due.length
}
