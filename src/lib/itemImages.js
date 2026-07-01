// ────────────────────────────────────────────────────────────────────────────
// itemImages.js  —  Multi-image storage for inventory items (max 3).
//
// Photos live in the public `item-images` Supabase Storage bucket; one row per
// photo is kept in the `item_images` table. The first photo (position 0) is also
// mirrored to items.image_url so existing single-image screens keep working.
// All uploads are compressed to <300 KB by the caller (imageCompress.js).
// ────────────────────────────────────────────────────────────────────────────

import { supabase } from './supabase'

export const MAX_IMAGES = 3
const BUCKET = 'item-images'

// List an item's photos, ordered (primary first).
export async function listItemImages(itemId) {
  const { data, error } = await supabase
    .from('item_images')
    .select('*')
    .eq('item_id', itemId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return []
  return data || []
}

// Upload a single (already compressed) File for an item. Returns the new row.
export async function uploadItemImage(itemId, file, { createdBy, position } = {}) {
  const existing = await listItemImages(itemId)
  if (existing.length >= MAX_IMAGES) {
    throw new Error(`Maximum ${MAX_IMAGES} photos per item.`)
  }
  const pos = Number.isFinite(position) ? position : existing.length
  const path = `${itemId}/${Date.now()}_${pos}.jpg`

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true, contentType: 'image/jpeg' })
  if (upErr) throw upErr

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)
  const url = `${publicUrl}?t=${Date.now()}`

  const { data: row, error: dbErr } = await supabase
    .from('item_images')
    .insert({ item_id: itemId, url, storage_path: path, position: pos, size_bytes: file.size, created_by: createdBy || null })
    .select()
    .single()
  if (dbErr) throw dbErr

  await syncPrimary(itemId)
  return row
}

// Remove one photo (row + underlying storage object).
export async function removeItemImage(image) {
  if (image.storage_path) {
    await supabase.storage.from(BUCKET).remove([image.storage_path]).catch(() => {})
  }
  const { error } = await supabase.from('item_images').delete().eq('id', image.id)
  if (error) throw error
  await syncPrimary(image.item_id)
}

// Keep items.image_url pointing at the current primary (first) photo.
async function syncPrimary(itemId) {
  const imgs = await listItemImages(itemId)
  const primary = imgs[0]?.url || null
  await supabase.from('items').update({ image_url: primary }).eq('id', itemId).catch(() => {})
}
