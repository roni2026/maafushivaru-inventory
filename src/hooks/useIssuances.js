import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

export function useIssuances(dateRange) {
  const [issuances, setIssuances] = useState([])
  const [loading,   setLoading]   = useState(true)

  const fetchIssuances = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('issuances')
      .select('*, items(id, part_number, name, unit, current_stock), stores(id, name)')
      .order('date',       { ascending: false })
      .order('created_at', { ascending: false })

    if (dateRange?.from) q = q.gte('date', dateRange.from)
    if (dateRange?.to)   q = q.lte('date', dateRange.to)

    const { data, error } = await q
    if (error) {
      toast.error('Failed to load issuances')
    } else {
      setIssuances(data || [])
    }
    setLoading(false)
  }, [dateRange?.from, dateRange?.to])

  useEffect(() => { fetchIssuances() }, [fetchIssuances])

  // ── Log a new issuance (deducts stock) ───────────────

  const logIssuance = async ({ itemId, storeId, quantityIssued, date, loggedBy }) => {
    // Fetch current stock
    const { data: item, error: fetchErr } = await supabase
      .from('items').select('current_stock').eq('id', itemId).single()
    if (fetchErr) throw fetchErr

    const newStock = Math.max(0, (Number(item.current_stock) || 0) - Number(quantityIssued))

    // Deduct from items
    const { error: stockErr } = await supabase
      .from('items').update({ current_stock: newStock }).eq('id', itemId)
    if (stockErr) throw stockErr

    // Log stock update
    await supabase.from('stock_updates').insert({
      item_id:         itemId,
      date:            date || new Date().toISOString().split('T')[0],
      quantity_change: -Number(quantityIssued),
      new_quantity:    newStock,
      updated_by:      loggedBy || 'System',
      note:            'Daily issuance',
    })

    // Create issuance record
    const { data: issuance, error: issErr } = await supabase
      .from('issuances')
      .insert({
        item_id:         itemId,
        store_id:        storeId,
        quantity_issued: quantityIssued,
        date:            date || new Date().toISOString().split('T')[0],
        logged_by:       loggedBy || 'System',
      })
      .select('*, items(id, part_number, name, unit, current_stock), stores(id, name)')
      .single()
    if (issErr) throw issErr

    setIssuances(prev => [issuance, ...prev])
    return { issuance, newStock }
  }

  // ── Helpers ────────────────────────────────────────────

  const getWeeklyTotal = (itemId) => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 7)
    return issuances
      .filter(i => i.item_id === itemId && new Date(i.date) >= cutoff)
      .reduce((sum, i) => sum + Number(i.quantity_issued), 0)
  }

  const getPrevWeekTotal = (itemId) => {
    const now = new Date()
    const w1Start = new Date(now); w1Start.setDate(w1Start.getDate() - 14)
    const w1End   = new Date(now); w1End.setDate(w1End.getDate() - 7)
    return issuances
      .filter(i => {
        const d = new Date(i.date)
        return i.item_id === itemId && d >= w1Start && d < w1End
      })
      .reduce((sum, i) => sum + Number(i.quantity_issued), 0)
  }

  return {
    issuances,
    loading,
    logIssuance,
    getWeeklyTotal,
    getPrevWeekTotal,
    refetch: fetchIssuances,
  }
}
