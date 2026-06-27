// ─────────────────────────────────────────────────────────────────────────────
// Local (browser / desktop) notifications.
//
// These run entirely on the device using the Web Notifications API and work
// ALONGSIDE the Brevo email reports — they are not a replacement. When enabled,
// the app raises a native desktop/mobile notification for new critical / high
// inventory alerts (out of stock, low stock, expired / expiring soon) the moment
// they are detected, even if the notification panel is closed.
//
// Preference + "already shown" tracking are kept in localStorage, so this is a
// per-device setting (each browser / device opts in separately). No backend or
// service worker is required.
// ─────────────────────────────────────────────────────────────────────────────

const ENABLED_KEY = 'local_notifications_enabled'
const SHOWN_KEY   = 'local_notifications_shown_v1'

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

function getShown() {
  try { return new Set(JSON.parse(localStorage.getItem(SHOWN_KEY) || '[]')) }
  catch { return new Set() }
}
function saveShown(set) {
  // Keep the list bounded so it can't grow forever.
  try { localStorage.setItem(SHOWN_KEY, JSON.stringify([...set].slice(-800))) } catch {}
}

// Fire a single test notification (used by the Settings "Send test" button).
export function sendTestNotification() {
  if (!localNotifsEnabled()) return false
  try {
    new Notification('🔔 Notifications enabled', {
      body: 'You will now get local alerts for low stock and expiring items.',
      tag: 'inv-test',
    })
    return true
  } catch { return false }
}

// Compare the freshly-fetched alerts against what we already raised, and pop a
// desktop notification for anything new at the requested severities. Returns the
// number of new notifications fired.
export function syncLocalNotifications(notifs, { severities = ['critical', 'high'] } = {}) {
  if (!localNotifsEnabled()) return 0
  const shown = getShown()
  const fresh = (notifs || []).filter(n => severities.includes(n.severity) && !shown.has(n.id))
  if (!fresh.length) return 0

  if (fresh.length > 5) {
    // Too many to show individually — send one concise summary.
    try {
      new Notification('Inventory alerts', {
        body: `${fresh.length} new stock / expiry alerts need attention.`,
        tag: 'inv-summary',
      })
    } catch {}
  } else {
    for (const n of fresh) {
      try { new Notification(n.title, { body: n.sub || '', tag: n.id }) } catch {}
    }
  }

  fresh.forEach(n => shown.add(n.id))
  saveShown(shown)
  return fresh.length
}
