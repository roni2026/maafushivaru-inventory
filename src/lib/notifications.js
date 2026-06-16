// In-app notification helper
import { supabase } from './supabase'

export async function fetchNotifications() {
  const today = new Date(); today.setHours(0,0,0,0)
  const d14   = new Date(today); d14.setDate(d14.getDate()-14)

  const [{ data: items }, { data: issuances }] = await Promise.all([
    supabase.from('items')
      .select('id, name, part_number, unit, current_stock, min_stock, expiry_date, stores(name)'),
    supabase.from('issuances')
      .select('item_id')
      .gte('date', d14.toISOString().split('T')[0]),
  ])

  const notifs = []

  ;(items || []).forEach(item => {
    // Expiry alerts
    if (item.expiry_date) {
      const exp  = new Date(item.expiry_date); exp.setHours(0,0,0,0)
      const days = Math.ceil((exp - today) / 86400000)
      if (days < 0) {
        notifs.push({ id:`exp-${item.id}`, type:'expired',  severity:'critical', title:`EXPIRED: ${item.name}`, sub:`${item.stores?.name} · Expired ${Math.abs(days)}d ago`, link:'/inventory' })
      } else if (days <= 7) {
        notifs.push({ id:`exp7-${item.id}`, type:'expiring', severity:'high', title:`${item.name} – ${days}d left`, sub:`${item.stores?.name} · Expires ${item.expiry_date}`, link:'/inventory' })
      } else if (days <= 15) {
        notifs.push({ id:`exp15-${item.id}`, type:'expiring', severity:'medium', title:`${item.name} – ${days}d left`, sub:`${item.stores?.name} · Expires ${item.expiry_date}`, link:'/inventory' })
      }
    }
    // Low / out of stock
    if (Number(item.current_stock) <= Number(item.min_stock)) {
      const isOut = Number(item.current_stock) === 0
      notifs.push({
        id:`stock-${item.id}`, type:'low_stock', severity: isOut ? 'critical' : 'high',
        title: isOut ? `OUT OF STOCK: ${item.name}` : `Low Stock: ${item.name}`,
        sub:`${item.stores?.name} · ${item.current_stock} / min ${item.min_stock} ${item.unit}`,
        link:'/inventory',
      })
    }
  })

  // No movement in 14 days
  const issuedIds = new Set((issuances || []).map(i => i.item_id))
  ;(items || []).filter(i => !issuedIds.has(i.id) && Number(i.current_stock) > 0).forEach(item => {
    notifs.push({
      id:`nomov-${item.id}`, type:'no_movement', severity:'low',
      title:`No Movement: ${item.name}`,
      sub:`${item.stores?.name} · Not issued in 14+ days`,
      link:'/analytics',
    })
  })

  return notifs
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
