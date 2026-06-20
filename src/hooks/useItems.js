import { useState, useEffect, useCallback } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'
import toast from 'react-hot-toast'

export function useItems() {
  const [items,   setItems]   = useState([])
  const [stores,  setStores]  = useState([])
  const [loading, setLoading] = useState(true)

  const fetchStores = useCallback(async () => {
    const { data, error } = await supabase
      .from('stores').select('*').order('category').order('name')
    if (!error) setStores(data || [])
  }, [])

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      // Paginated fetch — pulls ALL items, not just the first 1,000 that
      // Supabase returns by default.
      const data = await fetchAllRows(() =>
        supabase
          .from('items')
          .select('*, stores(id, name, category)')
          .order('expiry_date', { ascending: true, nullsFirst: false })
      )
      setItems(data)
    } catch (err) {
      console.error(err)
      toast.error('Failed to load items')
    } finally {
      setLoading(false)
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
    setItems(prev =>
      [...prev, data].sort((a, b) => {
        if (!a.expiry_date) return 1
        if (!b.expiry_date) return -1
        return new Date(a.expiry_date) - new Date(b.expiry_date)
      })
    )
    return data
  }

  const updateItem = async (id, updates) => {
    const { data, error } = await supabase
      .from('items')
      .update(updates)
      .eq('id', id)
      .select('*, stores(id, name, category)')
      .single()
    if (error) throw error
    setItems(prev => prev.map(i => (i.id === id ? data : i)))
    return data
  }

  const deleteItem = async (id) => {
    const { error } = await supabase.from('items').delete().eq('id', id)
    if (error) throw error
    setItems(prev => prev.filter(i => i.id !== id))
  }

  // ── Bulk activate / deactivate ──────────────────────────────
  // Deactivated items stay in the catalogue but are hidden from
  // reports, orders and operational flows. Updates the DB in one
  // call and patches local state in place.
  const setItemsActive = async (ids, active) => {
    if (!ids || ids.length === 0) return
    const { error } = await supabase
      .from('items')
      .update({ active })
      .in('id', ids)
    if (error) throw error
    const idSet = new Set(ids)
    setItems(prev => prev.map(i => (idSet.has(i.id) ? { ...i, active } : i)))
  }

  // ── Stock update (manual) ─────────────────────────────

  const updateStock = async ({ itemId, quantityChange, newQuantity, updatedBy, note, date }) => {
    const { error: stockErr } = await supabase
      .from('items')
      .update({ current_stock: newQuantity })
      .eq('id', itemId)
    if (stockErr) throw stockErr

    const { error: logErr } = await supabase.from('stock_updates').insert({
      item_id:         itemId,
      date:            date || new Date().toISOString().split('T')[0],
      quantity_change: quantityChange,
      new_quantity:    newQuantity,
      updated_by:      updatedBy || 'System',
      note,
    })
    if (logErr) throw logErr

    setItems(prev =>
      prev.map(i => (i.id === itemId ? { ...i, current_stock: newQuantity } : i))
    )
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
