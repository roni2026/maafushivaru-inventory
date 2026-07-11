import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, fetchAllRows, chunkedUpdateByIds } from '../lib/supabase'
import { logItemActivity } from '../lib/activity'
import toast from 'react-hot-toast'

export function useItems() {
  const [items,   setItems]   = useState([])
  const [stores,  setStores]  = useState([])
  const [loading, setLoading] = useState(true)

  // ── Race condition guard ──────────────────────────────────────────────
  // If fetchItems is called twice in quick succession (e.g. user clicks
  // Refresh while the initial load is still in flight), the older request
  // can resolve AFTER the newer one and overwrite fresh data with stale data.
  // This ref tracks the latest call so we can discard out-of-order responses.
  const fetchSeqRef = useRef(0)

  const fetchStores = useCallback(async () => {
    const { data, error } = await supabase
      .from('stores').select('*').order('category').order('name')
    if (error) {
      console.error('Failed to load stores:', error.message)
      return
    }
    setStores(data || [])
  }, [])

  const fetchItems = useCallback(async () => {
    const seq = ++fetchSeqRef.current
    setLoading(true)
    try {
      // Paginated fetch — pulls ALL items, not just the first 1,000 that
      // Supabase returns by default.
      const [data, { data: batches, error: batchErr }] = await Promise.all([
        fetchAllRows(() =>
          supabase
            .from('items')
            .select('*, stores(id, name, category)')
        ),
        supabase.from('item_batches').select('item_id, expiry_date, remaining_quantity'),
      ])
      // Discard this response if a newer fetchItems() call has started
      if (seq !== fetchSeqRef.current) return

      if (batchErr) {
        console.warn('Batch expiry fetch failed, continuing without:', batchErr.message)
      }
      // Batch Expiry is the ONE expiry system now -- attach each item's
      // earliest active batch expiry as a computed field (`_batchExpiry`)
      // instead of ever reading the legacy items.expiry_date column, which
      // is never written to for new stock anymore.
      const earliest = {}
      ;(batches || []).forEach(b => {
        if (!b.expiry_date || Number(b.remaining_quantity) <= 0) return
        if (!earliest[b.item_id] || b.expiry_date < earliest[b.item_id]) earliest[b.item_id] = b.expiry_date
      })
      const withExpiry = data.map(i => ({ ...i, _batchExpiry: earliest[i.id] || null }))
      setItems(withExpiry.sort((a, b) => {
        if (!a._batchExpiry) return 1
        if (!b._batchExpiry) return -1
        return new Date(a._batchExpiry) - new Date(b._batchExpiry)
      }))
    } catch (err) {
      if (seq !== fetchSeqRef.current) return
      console.error('Failed to load items:', err)
      toast.error('Failed to load items')
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStores()
    fetchItems()
  }, [fetchStores, fetchItems])

  // ── CRUD ──────────────────────────────────────────────

  const addItem = async (itemData) => {
    const { data, error } = await supabase
      .from('items')
      .insert(itemData)
      .select('*, stores(id, name, category)')
      .single()
    if (error) throw error
    logItemActivity(data.id, 'created', `Item created: ${data.name}`).catch(() => {})
    setItems(prev =>
      [...prev, { ...data, _batchExpiry: null }].sort((a, b) => {
        if (!a._batchExpiry) return 1
        if (!b._batchExpiry) return -1
        return new Date(a._batchExpiry) - new Date(b._batchExpiry)
      })
    )
    return data
  }

  const updateItem = async (id, updates) => {
    const prevItem = items.find(i => i.id === id)
    // Optimistic update: apply the patch to local state immediately so the
    // UI feels instant. If the server rejects it, we roll back below.
    setItems(prev => prev.map(i => (i.id === id ? { ...i, ...updates } : i)))
    const { data, error } = await supabase
      .from('items')
      .update(updates)
      .eq('id', id)
      .select('*, stores(id, name, category)')
      .single()
    if (error) {
      // Roll back to the previous state on failure
      if (prevItem) setItems(prev => prev.map(i => (i.id === id ? prevItem : i)))
      throw error
    }
    // Distinguish a sub-category (store) move from a general edit.
    if ('store_id' in updates && prevItem && prevItem.store_id !== data.store_id) {
      logItemActivity(id, 'subcategory_changed', `Moved to ${data.stores?.name || 'another sub-category'}`).catch(() => {})
    } else {
      logItemActivity(id, 'edited', 'Item details edited').catch(() => {})
    }
    setItems(prev => prev.map(i => (i.id === id ? { ...data, _batchExpiry: i._batchExpiry ?? null } : i)))
    return data
  }

  const deleteItem = async (id) => {
    const prevItems = items
    // Optimistic delete
    setItems(prev => prev.filter(i => i.id !== id))
    const { error } = await supabase.from('items').delete().eq('id', id)
    if (error) {
      // Roll back on failure
      setItems(prevItems)
      throw error
    }
  }

  // ── Bulk activate / deactivate ──────────────────────────────
  // Deactivated items stay in the catalogue but are hidden from
  // reports, orders and operational flows. Updates the DB in one
  // call and patches local state in place.
  const setItemsActive = async (ids, active) => {
    if (!ids || ids.length === 0) return
    // Optimistic update
    const idSet = new Set(ids)
    setItems(prev => prev.map(i => (idSet.has(i.id) ? { ...i, active } : i)))
    // Batched (not one giant `.in('id', ids)` call) — with many UUIDs that
    // single request's URL can exceed the server's length limit and fail
    // with a generic 400 Bad Request past just a handful of selected items.
    const { failed, errors } = await chunkedUpdateByIds('items', ids, { active })
    if (failed) {
      // Roll back on failure
      setItems(prev => prev.map(i => (idSet.has(i.id) ? { ...i, active: !active } : i)))
      throw new Error(errors[0] || `Failed to update ${failed} item${failed !== 1 ? 's' : ''}`)
    }
    ids.forEach(id => logItemActivity(id, active ? 'activated' : 'deactivated', active ? 'Item activated' : 'Item deactivated').catch(() => {}))
  }

  // ── Stock update (manual) ─────────────────────────────

  // Stock is ALWAYS derived from Batch Expiry (SUM of remaining_quantity).
  // This never writes items.current_stock directly anymore -- it calls the
  // shared adjust_item_stock() RPC, which either tops up a no-expiry
  // "adjustment" batch (increase) or consumes existing batches FIFO
  // (decrease), exactly like the website and Android issuing flows. This
  // guarantees a manual "Update Stock" edit can never be silently
  // overwritten by the next batch change.
  const updateStock = async ({ itemId, quantityChange, updatedBy, note, date }) => {
    // Guard against null/undefined itemId — calling the RPC with a null id
    // produces a cryptic PostgREST error instead of a clear message.
    if (!itemId) throw new Error('Item ID is required')
    const delta = Number(quantityChange)
    if (isNaN(delta)) throw new Error('Quantity change must be a number')

    // Optimistic update: adjust local stock immediately for responsive UI.
    // The RPC returns the authoritative new quantity, which we apply after.
    const prevStock = items.find(i => i.id === itemId)?.current_stock
    if (prevStock != null) {
      setItems(prev =>
        prev.map(i => (i.id === itemId ? { ...i, current_stock: prevStock + delta } : i))
      )
    }

    const { data: newQuantity, error } = await supabase.rpc('adjust_item_stock', {
      p_item_id: itemId,
      p_delta: delta,
      p_note: note || null,
      p_updated_by: updatedBy || 'System',
    })
    if (error) {
      // Roll back optimistic update on failure
      if (prevStock != null) {
        setItems(prev =>
          prev.map(i => (i.id === itemId ? { ...i, current_stock: prevStock } : i))
        )
      }
      throw error
    }

    const act = delta > 0 ? 'stock_add' : delta < 0 ? 'stock_remove' : 'stock_set'
    logItemActivity(itemId, act, `${delta >= 0 ? '+' : ''}${delta} → ${newQuantity}${note ? ' · ' + note : ''}`).catch(() => {})

    // Apply the authoritative value from the server
    setItems(prev =>
      prev.map(i => (i.id === itemId ? { ...i, current_stock: newQuantity } : i))
    )
    return newQuantity
  }

  return {
    items,
    stores,
    loading,
    addItem,
    updateItem,
    deleteItem,
    setItemsActive,
    updateStock,
    refetch: fetchItems,
  }
}
