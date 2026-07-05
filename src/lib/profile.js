// ─────────────────────────────────────────────────────────────
// profile.js — current-user profile helpers.
// Lets every screen say "who is logged in right now?" instead of
// asking the user to type their name (e.g. Waste Log), and backs
// the Profile page where a user edits their own info.
// ─────────────────────────────────────────────────────────────
import { supabase } from './supabase'

// Fetch (and lazily create, in case the signup trigger hasn't run yet)
// the profile row for the currently signed-in user.
export async function getCurrentProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  let { data: profile, error } = await supabase
    .from('profiles').select('*').eq('id', user.id).maybeSingle()
  if (error) throw error

  if (!profile) {
    const fallbackName = user.user_metadata?.full_name || (user.email || '').split('@')[0]
    const { data: created, error: insertErr } = await supabase
      .from('profiles')
      .insert({ id: user.id, full_name: fallbackName })
      .select('*').single()
    if (insertErr) {
      // Someone else created it in a race — just re-fetch.
      const retry = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      profile = retry.data
    } else {
      profile = created
    }
  }

  return { ...profile, email: user.email, user_id: user.id }
}

// Best-effort display name for the signed-in user — falls back to
// their email (or "Unknown") if no profile / name has been set yet.
export async function getCurrentUserName() {
  try {
    const profile = await getCurrentProfile()
    if (!profile) return 'Unknown'
    return profile.full_name?.trim() || profile.email || 'Unknown'
  } catch {
    return 'Unknown'
  }
}

export async function updateCurrentProfile(patch) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { data, error } = await supabase
    .from('profiles')
    .upsert({ id: user.id, ...patch }, { onConflict: 'id' })
    .select('*').single()
  if (error) throw error
  return data
}
