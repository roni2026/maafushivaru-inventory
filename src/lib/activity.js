// ────────────────────────────────────────────────────────────────────────────
// activity.js  —  Per-item audit trail helpers.
//
// Records who changed an item and when, so item screens can show
// "last updated <when> by <who>" plus a "view more" list of the last 15 changes.
// Every mutation should also stamp items.updated_by / updated_at.
// ────────────────────────────────────────────────────────────────────────────

import { supabase } from './supabase'

// Resolve a friendly actor name for the currently signed-in user.
let _actorCache = null
export async function currentActor() {
  if (_actorCache) return _actorCache
  try {
    const { data } = await supabase.auth.getUser()
    const u = data?.user
    _actorCache =
      u?.user_metadata?.full_name ||
      u?.user_metadata?.name ||
      u?.email ||
      'Unknown'
  } catch {
    _actorCache = 'Unknown'
  }
  return _actorCache
}

// Log an activity row. `action` is a short machine code, `detail` a human string.
// Best-effort: never throws (a failed audit write must not block the real action).
export async function logItemActivity(itemId, action, detail) {
  if (!itemId) return
  try {
    const changed_by = await currentActor()
    await supabase.from('item_activity').insert({
      item_id: itemId, action, detail: detail || null, changed_by,
    })
    // Keep items.updated_by / updated_at in sync (updated_at handled by trigger).
    await supabase.from('items').update({ updated_by: changed_by }).eq('id', itemId)
  } catch {
    /* non-critical */
  }
}

// Fetch the most recent activity for an item (default 15).
export async function fetchItemActivity(itemId, limit = 15) {
  const { data, error } = await supabase
    .from('item_activity')
    .select('*')
    .eq('item_id', itemId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return []
  return data || []
}

// Pretty label for an action code.
export function actionLabel(action) {
  const map = {
    created:              'Created',
    edited:               'Edited details',
    subcategory_changed:  'Moved sub-category',
    stock_add:            'Stock added',
    stock_remove:         'Stock removed',
    stock_set:            'Stock set',
    photo_added:          'Photo added',
    photo_removed:        'Photo removed',
    received:             'Received (boat note)',
    deactivated:          'Deactivated',
    activated:            'Activated',
  }
  return map[action] || action
}
