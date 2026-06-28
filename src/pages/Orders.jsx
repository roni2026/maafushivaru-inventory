import { useState, useCallback, useMemo, useEffect } from 'react'
import { supabase, selectAll } from '../lib/supabase'
import {
  ShoppingCart, Download, RefreshCw, Minus, Plus, Save,
  ChevronDown, ChevronRight, AlertTriangle, PackageX, CheckCircle2,
  Search, Upload, X, PlusCircle
} from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import Modal from '../components/ui/Modal'
import Input, { Textarea } from '../components/ui/Input'
import CSVImportModal from '../components/CSVImportModal'
import { CSV_CONFIGS } from '../lib/csvTemplates'
import { exportOrderExcel } from '../lib/excelExport'
import { classifyOrigin, deliveryDayFor, canDeliverOn, deliveryLabelFor } from '../lib/boatnote'
import { useSort } from '../hooks/useSort'
// Learned order pattern — pre-computed average weekly STORE order quantities
// derived from a large batch of historical boat notes. Used as a fallback so the
// "By Pattern" list is useful even before boat notes are posted to the database.
import ORDER_PATTERN from '../lib/orderPattern.json'

const PATTERN_BY_CODE = new Map(
  (ORDER_PATTERN?.items || []).map(p => [String(p.code || '').replace(/^0+/, ''), p])
)

// ── Helpers ───────────────────────────────────────────────────
function nextDelivery() {
  const today = new Date(); const day = today.getDay()
  const targets = [1, 4]; let minDiff = 8
  for (const t of targets) {
    let diff = (t - day + 7) % 7; if (diff === 0) diff = 7
    if (diff < minDiff) minDiff = diff
  }
  const d = new Date(today); d.setDate(d.getDate() + minDiff)
  return { date: d, label: d.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' }) }
}
// Next occurrence of a specific weekday (Monday / Thursday) for a targeted order.
function nextDeliveryFor(dayName) {
  if (!dayName || dayName === 'auto' || dayName === 'week') return nextDelivery()
  const map = { Sunday:0, Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6 }
  const target = map[dayName] ?? 1
  const today = new Date(); let diff = (target - today.getDay() + 7) % 7; if (diff === 0) diff = 7
  const d = new Date(today); d.setDate(d.getDate() + diff)
  return { date: d, label: d.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' }) }
}
function weekRange(weeksBack = 0) {
  const now = new Date()
  const toDate = new Date(now); toDate.setDate(toDate.getDate() - weeksBack * 7)
  const frDate = new Date(toDate); frDate.setDate(frDate.getDate() - 7)
  return { from: frDate.toISOString().split('T')[0], to: toDate.toISOString().split('T')[0] }
}

const STATUS_BADGE = { pending:'yellow', partial:'orange', received:'green', cancelled:'red' }

// Round an order quantity UP to a whole number of packs (e.g. pack of 6/10/12).
function roundToPack(qty, pack) {
  const p = Number(pack) || 1
  if (p <= 1) return Math.max(0, Math.ceil(qty))
  return Math.max(0, Math.ceil(Math.ceil(qty) / p) * p)
}
const MAIN_CATEGORIES = ['Food', 'General', 'Beverage']
// An item counts as active unless it has been explicitly deactivated. This
// tolerates databases where the `active` column is missing or NULL (which a
// strict `.eq('active', true)` filter would wrongly treat as "no items").
const isActiveItem = (i) => i && i.active !== false

export default function Orders() {
  const [tab,       setTab]      = useState('generate')
  const [orderMode, setOrderMode]= useState('pattern')  // 'pattern' | 'usage'
  const [deliveryDay, setDeliveryDay] = useState('week') // 'week' | 'Monday' | 'Thursday'
  const [storeOnly, setStoreOnly]= useState(true)   // STORE-only, boat-note driven
  const [boatStats, setBoatStats]= useState(null)   // { weeks, items: Map<code,{qty,n}> }
  const [rows,      setRows]     = useState([])
  const [delivery,  setDelivery] = useState(null)
  const [loading,   setLoading]  = useState(false)
  const [exportingPdf,  setExportingPdf]  = useState(false)
  const [exportingXlsx, setExportingXlsx] = useState(false)
  const [saving,    setSaving]   = useState(false)
  const [resortName,setResortName]=useState('Outrigger Maafushivaru Resort')
  const [showCSV,   setShowCSV]  = useState(false)

  // ── Order-quantity controls ────────────────────────────────────────────────
  const [backupWeeks,  setBackupWeeks]  = useState(0)   // extra weeks of safety stock
  const [subtractStock,setSubtractStock]= useState(true)// net need vs gross target

  // Export layout: 'normal' (regular sorting) | 'category' (Beverage → Food → General)
  const [exportMode, setExportMode] = useState('normal')

  // Thresholds (from Settings): per-category MAX order qty + usual order UOM.
  // A blank / 0 max means "no cap" for that category.
  const [thresholds, setThresholds] = useState({ Food: null, General: null, Beverage: null, uom: 'pcs' })

  // ── List filters (category / sub-category / needed) ────────────────────────
  const [catFilter,  setCatFilter]  = useState('')   // '' | Food | Beverage | General
  const [subFilter,  setSubFilter]  = useState('')   // store (sub-category) name
  const [needFilter, setNeedFilter] = useState('all')// all | selected | unselected

  // ── Pending (undelivered) from last orders ─────────────────
  const [pendingItems,    setPendingItems]    = useState([])
  const [pendingDismissed,setPendingDismissed]= useState(false)

  // ── Manual add item to current order ──────────────────────
  const [showAddItem,   setShowAddItem]   = useState(false)
  const [allItems,      setAllItems]      = useState([])
  const [itemSearch,    setItemSearch]    = useState('')
  const [selectedItem,  setSelectedItem]  = useState(null)
  const [manualQty,     setManualQty]     = useState('')
  const [manualNote,    setManualNote]    = useState('')

  // ── Order history ──────────────────────────────────────────
  const [history,       setHistory]       = useState([])
  const [histLoad,      setHistLoad]      = useState(false)
  const [expanded,      setExpanded]      = useState(null)
  const [expandedItems, setExpandedItems] = useState({})
  const [markingId,     setMarkingId]     = useState(null)

  // ── Add item to saved order (history) ───────────────────
  const [showAddToOrder, setShowAddToOrder]   = useState(null) // orderId
  const [savedItemSearch,setSavedItemSearch]  = useState('')
  const [savedItem,      setSavedItem]        = useState(null)
  const [savedQty,       setSavedQty]         = useState('')
  const [savedNote,      setSavedNote]        = useState('')
  const [addingToOrder,  setAddingToOrder]    = useState(false)

  // ── Manual Order builder (search items → add qty → export) ────────────────
  const [manualRows,   setManualRows]   = useState([])
  const [manualSearch, setManualSearch] = useState('')
  const [manualExporting, setManualExporting] = useState(false)

  // ── Load all items for manual add ─────────────────────────
  const loadAllItems = async () => {
    if (allItems.length) return
    const { data } = await selectAll(() => supabase.from('items').select('id,name,part_number,unit,current_stock,active,stores(name)').order('name'))
    let list = (data || []).filter(isActiveItem)
    if (list.length === 0 && (data || []).length > 0) list = data
    setAllItems(list)
  }

  // ── Check undelivered from previous orders ─────────────────
  const checkUndeliveredItems = useCallback(async () => {
    const { data: oldOrders } = (await supabase.from('order_history')
      .select('id,delivery_date,delivery_day,status')
      .in('status', ['pending','partial'])
      .order('created_at', { ascending: false }).limit(3)) || {}
    if (!oldOrders?.length) { setPendingItems([]); return }
    const undelivered = []
    for (const order of oldOrders) {
      const { data: oItems } = (await supabase.from('order_history_items').select('*').eq('order_id', order.id)) || {}
      ;(oItems || []).forEach(i => {
        const shortfall = Number(i.ordered_qty) - Number(i.received_qty)
        if (shortfall > 0) undelivered.push({ ...i, shortfall, orderDate: order.delivery_date, orderDay: order.delivery_day || 'Previous', orderId: order.id, orderStatus: order.status })
      })
    }
    setPendingItems(undelivered)
    setPendingDismissed(false)
  }, [])

  // ── Generate order ─────────────────────────────────────────
  const generate = useCallback(async () => {
    setLoading(true); setPendingItems([]); setPendingDismissed(false)
    try {
      const { data: settings } = (await supabase.from('settings').select('key,value')) || {}
      const smap = (settings || []).reduce((a, s) => ({ ...a, [s.key]: s.value }), {})
      if (smap.resort_name) setResortName(smap.resort_name)
      // Per-category order caps + usual UOM (blank = no cap).
      const numOrNull = (v) => { const n = Number(v); return isFinite(n) && n > 0 ? n : null }
      const caps = {
        Food:     numOrNull(smap.order_max_food),
        General:  numOrNull(smap.order_max_general),
        Beverage: numOrNull(smap.order_max_beverage),
        uom:      smap.order_default_uom || 'pcs',
      }
      setThresholds(caps)
      // Fetch items as ROBUSTLY as possible. We do NOT rely on the items→stores
      // embed (which silently returns an empty/erroring set on some databases and
      // was the cause of the "No items found" message). Instead we fetch items
      // with a plain select and join the store name/category in JS.
      let allItems = []
      // a) paginated plain select (handles >1000 rows)
      const plain = await selectAll(() => supabase.from('items').select('*'))
      if (plain?.data?.length) allItems = plain.data
      // b) last-resort direct select if pagination wrapper failed for any reason
      if (allItems.length === 0) {
        const direct = await supabase.from('items').select('*').limit(10000)
        if (direct?.data?.length) allItems = direct.data
      }
      // Attach store name + category from the stores table (client-side join).
      try {
        const { data: storesData } = await supabase.from('stores').select('id,name,category')
        const storeMap = new Map((storesData || []).map(st => [st.id, st]))
        allItems = allItems.map(i => ({ ...i, stores: i.stores || storeMap.get(i.store_id) || null }))
      } catch { /* stores optional — proceed without category */ }

      // Active unless explicitly deactivated. If that hides EVERY item
      // (e.g. every row has active=false / NULL on this DB), fall back to all.
      let items = allItems.filter(isActiveItem)
      if (items.length === 0 && allItems.length > 0) items = allItems
      console.info('[orders] generate — items fetched:', allItems.length, '· usable:', items.length)
      if (items.length === 0) {
        toast.error('No items found. Add items in Inventory first, or use the Manual Order tab.')
        setRows([]); setLoading(false); return
      }

      // ── Boat-note demand: avg weekly ordered qty per item code, from the STORE
      //    department of every posted boat note (this is what we actually re-order).
      //    These tables may not exist yet on a fresh database — guard every read.
      const { data: bnItems } = (await selectAll(() =>
        supabase.from('boat_note_items').select('part_number,ordered_qty,department,boat_note_id'))) || {}
      const { data: bnotes } = (await supabase.from('boat_notes').select('id,note_date')) || {}
      const noteDate = new Map((bnotes || []).map(n => [n.id, n.note_date]))
      const code = (s) => String(s || '').replace(/^0+/, '')
      const storeBn = (bnItems || []).filter(b => (b.department || '').toUpperCase() === 'STORE')
      const bnByCode = new Map()
      let minD = null, maxD = null
      for (const b of storeBn) {
        const c = code(b.part_number); if (!c) continue
        const e = bnByCode.get(c) || { qty: 0, n: 0 }
        e.qty += Number(b.ordered_qty) || 0; e.n += 1; bnByCode.set(c, e)
        const d = noteDate.get(b.boat_note_id); if (d) { if (!minD || d < minD) minD = d; if (!maxD || d > maxD) maxD = d }
      }
      const bnWeeks = (minD && maxD) ? Math.max(1, (new Date(maxD) - new Date(minD)) / 6048e5) : 1
      setBoatStats({ weeks: Math.round(bnWeeks * 10) / 10, count: bnByCode.size })

      // ── Issuance demand (2-week average) — used as a fallback / cross-check ──
      const tw = weekRange(0); const lw = weekRange(1)
      const { data: thisIss } = (await selectAll(() => supabase.from('issuances').select('item_id,quantity_issued').gte('date', tw.from).lte('date', tw.to))) || {}
      const { data: lastIss } = (await selectAll(() => supabase.from('issuances').select('item_id,quantity_issued').gte('date', lw.from).lte('date', lw.to))) || {}
      const sum = (list, id) => (list || []).filter(i => i.item_id === id).reduce((s, i) => s + Number(i.quantity_issued), 0)

      const orderRows = (items || []).map(item => {
        const issAvg = (sum(thisIss, item.id) + sum(lastIss, item.id)) / 2
        const bn = bnByCode.get(code(item.part_number))
        // Posted boat-note history wins; otherwise fall back to the learned
        // pattern computed from historical boat notes (lib/orderPattern.json).
        const patt = PATTERN_BY_CODE.get(code(item.part_number))
        const bnAvg = bn ? bn.qty / bnWeeks : (patt ? Number(patt.avg_weekly) || 0 : 0)
        // ── Generation mode ──────────────────────────────────────────────
        //  • BY PATTERN → the general/standard order list: typical ordered
        //    quantity from boat-note ordering history (what we normally buy).
        //  • BY USAGE   → driven by issuance usage history (what was actually
        //    consumed), falling back to the boat-note pattern only if there is
        //    no usage signal at all.
        const avgWeekly = orderMode === 'usage'
          ? (issAvg > 0 ? issAvg : bnAvg)
          : (bnAvg > 0 ? bnAvg : issAvg)
        // Whole-week target = weekly average × multiplier × (1 + backup weeks).
        // Multiplier scales the weekly sum (a day's usage ≈ week ÷ ~5-6 since we
        // rarely issue on the supply day); backup weeks add safety cover. The
        // result is rounded UP to a whole number of packs.
        const pack = Number(item.pack_size) || 1
        const category = item.stores?.category || ''
        const target = avgWeekly * (1 + backupWeeks)
        const net = subtractStock ? target - Number(item.current_stock || 0) : target
        let suggested = roundToPack(Math.max(0, net), pack)
        // Apply per-category maximum (threshold) if one is configured.
        const capRaw = caps[category]
        if (capRaw != null) suggested = Math.min(suggested, roundToPack(capRaw, pack))
        const origin = item.origin || classifyOrigin(item.name)
        return {
          id: item.id, part_number: item.part_number, name: item.name,
          store: item.stores?.name || '', category: item.stores?.category || '',
          unit: item.unit, current_stock: item.current_stock, min_stock: item.min_stock,
          pack,
          thisWeek: Math.round(issAvg * 10) / 10, lastWeek: 0,
          avgWeekly: Math.round(avgWeekly * 10) / 10, suggested, ordered: suggested,
          selected: suggested > 0, _edited: false,
          origin, deliveryDay: deliveryDayFor(origin), _inBoatNote: !!bn || !!patt, _fromBoatNote: bnAvg > 0,
          _fromPending: false, _pendingNote: '', _manuallyAdded: false,
        }
      })
      // PATTERN mode shows the full general list; USAGE mode shows only what
      // actually needs reordering based on consumption.
      .filter(r => orderMode === 'pattern' ? true : (r.suggested > 0 || r.current_stock <= r.min_stock))

      // STORE-only = items that appear in the STORE department of past boat notes
      // (or the learned pattern). Honour the toggle, but never return an empty
      // sheet when we actually have items: fall back to the full list if
      // STORE-only is on yet matches nothing (e.g. no boat notes posted yet).
      const storeRows = orderRows.filter(r => r._inBoatNote)
      let finalRows = storeOnly ? storeRows : orderRows
      if (storeOnly && finalRows.length === 0 && orderRows.length > 0) {
        finalRows = orderRows
        toast('No boat-note history yet — showing the full item list.', { icon: 'ℹ️' })
      }
      finalRows = [...finalRows].sort((a, b) =>
        (a.origin || '').localeCompare(b.origin || '') || (a.name || '').localeCompare(b.name || ''))

      setRows(finalRows); setDelivery(nextDeliveryFor(deliveryDay))
      await checkUndeliveredItems()
    } catch (err) {
      console.error('Order generation failed:', err)
      toast.error('Order generation failed: ' + (err?.message || 'unexpected error'))
      setRows([])
    }
    setLoading(false)
  }, [checkUndeliveredItems, storeOnly, orderMode, deliveryDay, backupWeeks, subtractStock])

  // ── Add undelivered to current order ──────────────────────
  const addPendingToOrder = () => {
    setRows(prev => {
      const updated = [...prev]; let added = 0; let merged = 0
      for (const pending of pendingItems) {
        const existingIdx = updated.findIndex(r => r.id === pending.item_id)
        if (existingIdx >= 0) {
          updated[existingIdx] = { ...updated[existingIdx], ordered: Number(updated[existingIdx].ordered) + Number(pending.shortfall), _fromPending: true, _pendingNote: `Incl. ${pending.shortfall} ${pending.unit} undelivered from ${pending.orderDay}` }
          merged++
        } else {
          updated.push({ id: pending.item_id || `pending-${pending.id}`, part_number: pending.part_number, name: pending.item_name, store: pending.store_name || '', unit: pending.unit, current_stock: 0, min_stock: 0, thisWeek: 0, lastWeek: 0, avgWeekly: 0, suggested: pending.shortfall, ordered: pending.shortfall, _fromPending: true, _pendingNote: `Undelivered from ${pending.orderDay} (${pending.orderDate})`, _manuallyAdded: false })
          added++
        }
      }
      toast.success(`Carried over ${pendingItems.length} undelivered item${pendingItems.length !== 1 ? 's' : ''} — ${added} added, ${merged} merged`)
      return updated
    })
    setPendingItems([])
  }

  // ── Open manual-add modal ──────────────────────────────────
  const openAddItem = async () => {
    await loadAllItems()
    setSelectedItem(null); setItemSearch(''); setManualQty(''); setManualNote('')
    setShowAddItem(true)
  }

  // ── Add item manually to current order rows ────────────────
  const confirmAddItem = () => {
    if (!selectedItem)  { toast.error('Select an item'); return }
    if (!manualQty || Number(manualQty) <= 0) { toast.error('Enter quantity'); return }
    setRows(prev => {
      const existingIdx = prev.findIndex(r => r.id === selectedItem.id)
      if (existingIdx >= 0) {
        const updated = [...prev]
        updated[existingIdx] = { ...updated[existingIdx], ordered: Number(updated[existingIdx].ordered) + Number(manualQty), _manuallyAdded: true, _pendingNote: `+${manualQty} manually added${manualNote ? ': ' + manualNote : ''}` }
        toast.success(`Added ${manualQty} ${selectedItem.unit} to existing row for ${selectedItem.name}`)
        return updated
      }
      toast.success(`${selectedItem.name} added to order`)
      return [...prev, {
        id: selectedItem.id, part_number: selectedItem.part_number, name: selectedItem.name,
        store: selectedItem.stores?.name || '', unit: selectedItem.unit,
        current_stock: selectedItem.current_stock, min_stock: 0,
        thisWeek: 0, lastWeek: 0, avgWeekly: 0,
        suggested: Number(manualQty), ordered: Number(manualQty),
        _fromPending: false, _manuallyAdded: true,
        _pendingNote: manualNote ? `Manual: ${manualNote}` : 'Manually added',
      }]
    })
    setShowAddItem(false)
  }

  // ── Add item to a SAVED order in history ──────────────────
  const openAddToSavedOrder = async (orderId) => {
    await loadAllItems()
    setSavedItem(null); setSavedItemSearch(''); setSavedQty(''); setSavedNote('')
    setShowAddToOrder(orderId)
  }

  const confirmAddToSavedOrder = async () => {
    if (!savedItem)  { toast.error('Select an item'); return }
    if (!savedQty || Number(savedQty) <= 0) { toast.error('Enter quantity'); return }
    setAddingToOrder(true)
    const { error } = await supabase.from('order_history_items').insert({
      order_id:    showAddToOrder,
      item_id:     savedItem.id,
      part_number: savedItem.part_number,
      item_name:   savedItem.name,
      store_name:  savedItem.stores?.name || '',
      unit:        savedItem.unit,
      ordered_qty: Number(savedQty),
      received_qty:0,
    })
    if (error) { toast.error(error.message); setAddingToOrder(false); return }
    // Refresh that order's items
    const { data } = await supabase.from('order_history_items').select('*').eq('order_id', showAddToOrder)
    setExpandedItems(p => ({ ...p, [showAddToOrder]: data || [] }))
    toast.success(`${savedItem.name} added to order`)
    setShowAddToOrder(null); setAddingToOrder(false)
  }

  // ── Quantity helpers ───────────────────────────────────────
  const adjustQty = (id, delta) => setRows(prev => prev.map(r => r.id === id ? { ...r, ordered: Math.max(0, (Number(r.ordered) || 0) + delta * (Number(r.pack) || 1)), _edited: true } : r))
  const setQty    = (id, val) => { const n = parseFloat(val); if (!isNaN(n) && n >= 0) setRows(prev => prev.map(r => r.id === id ? { ...r, ordered: n, _edited: true } : r)) }
  const setPack   = (id, val) => { const p = Math.max(1, parseInt(val, 10) || 1); setRows(prev => prev.map(r => r.id === id ? { ...r, pack: p, ordered: roundToPack(Number(r.ordered) || 0, p) } : r)) }
  const removeRow = (id) => { setRows(prev => prev.filter(r => r.id !== id)); toast.success('Item removed from order') }

  // ── Row selection (only selected rows go into the order) ────────────────────
  const toggleSelect    = (id) => setRows(prev => prev.map(r => r.id === id ? { ...r, selected: !r.selected } : r))
  const selectAll       = () => setRows(prev => prev.map(r => ({ ...r, selected: true })))
  const clearSelection  = () => setRows(prev => prev.map(r => ({ ...r, selected: false })))
  // "Low stock / needs more" — items at or below min stock, or with a suggested qty.
  const selectLowStock  = () => setRows(prev => prev.map(r =>
    (Number(r.current_stock) <= Number(r.min_stock) || r.suggested > 0) ? { ...r, selected: true } : r))

  // ── Live re-apply of multiplier / backup weeks / subtract-stock ─────────────
  // Recomputes suggested + order qty for rows the user hasn't manually edited,
  // so changing the controls updates the list instantly (manual edits kept).
  useEffect(() => {
    setRows(prev => prev.map(r => {
      if (r._manuallyAdded || r._fromPending || r._edited) return r
      const pack = Number(r.pack) || 1
      const target = (Number(r.avgWeekly) || 0) * (1 + backupWeeks)
      const net = subtractStock ? target - Number(r.current_stock || 0) : target
      let suggested = roundToPack(Math.max(0, net), pack)
      const cap = thresholds[r.category]
      if (cap != null) suggested = Math.min(suggested, roundToPack(cap, pack))
      return { ...r, suggested, ordered: suggested, selected: suggested > 0 ? true : r.selected }
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backupWeeks, subtractStock, thresholds])

  // ── Build export groups: 'normal' = by sub-category (store), 'category' =
  //    by main category in fixed order Beverage → Food → General. ──────────
  const CATEGORY_ORDER = ['Beverage', 'Food', 'General']
  const buildGroups = (list) => {
    if (exportMode === 'category') {
      const grouped = {}
      // seed in the required display order so iteration follows Beverage→Food→General
      for (const c of CATEGORY_ORDER) {
        if (list.some(r => (r.category || 'Uncategorised') === c)) grouped[c] = []
      }
      for (const r of list) {
        const key = r.category || 'Uncategorised'
        ;(grouped[key] = grouped[key] || []).push(r)
      }
      // within each category, sort by sub-category then name for a clean sheet
      for (const k of Object.keys(grouped)) {
        grouped[k].sort((a, b) => (a.store || '').localeCompare(b.store || '') || (a.name || '').localeCompare(b.name || ''))
      }
      return grouped
    }
    // normal — group by sub-category (store), regular alphabetical sorting
    const grouped = {}
    for (const r of [...list].sort((a, b) => (a.store || '').localeCompare(b.store || '') || (a.name || '').localeCompare(b.name || ''))) {
      ;(grouped[r.store || 'Unassigned'] = grouped[r.store || 'Unassigned'] || []).push(r)
    }
    return grouped
  }

  // ── Export PDF ─────────────────────────────────────────────
  const exportPDF = async () => {
    if (!orderRows.length || !delivery) { toast.error('No selected items to export'); return }
    setExportingPdf(true)
    try {
      const { default: jsPDF }     = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF({ unit:'mm', format:'a4' })
      const cyan = [0, 174, 239]
      const delivDay  = delivery.date.toLocaleDateString('en-US', { weekday:'long' })
      const delivDate = delivery.date.toLocaleDateString('en-US', { day:'numeric', month:'long', year:'numeric' })
      doc.setFillColor(...cyan); doc.rect(0, 0, 210, 28, 'F')
      doc.setTextColor(255,255,255); doc.setFontSize(18); doc.setFont('helvetica','bold')
      doc.text(resortName, 14, 12)
      doc.setFontSize(13); doc.setFont('helvetica','normal')
      doc.text(`Order for ${delivDay} – ${delivDate}`, 14, 21)
      const grouped = buildGroups(orderRows)
      let y = 36
      for (const [store, items] of Object.entries(grouped)) {
        doc.setTextColor(0); doc.setFontSize(11); doc.setFont('helvetica','bold')
        doc.text(store || 'Unassigned', 14, y)
        autoTable(doc, {
          startY: y + 3,
          head: [['Part #','Item','Unit','Pack','In Stock','Avg/Wk','Suggested','Order Qty','Notes']],
          body: items.map(i => [i.part_number, i.name, i.unit, i.pack || 1, i.current_stock, i.avgWeekly, i.suggested, i.ordered, i._pendingNote || (i._manuallyAdded ? 'Manual' : '')]),
          headStyles: { fillColor: cyan, fontSize: 8 }, styles: { fontSize: 8 },
          alternateRowStyles: { fillColor: [248,250,252] }, columnStyles: { 8: { cellWidth: 32, fontSize: 7 } },
        })
        y = doc.lastAutoTable.finalY + 8
      }
      doc.save(`Order_${delivDay}_${delivery.date.toISOString().split('T')[0]}.pdf`)
      toast.success('PDF exported')
    } catch (err) { toast.error('Export failed: ' + err.message) }
    setExportingPdf(false)
  }

  // ── Export styled Excel ────────────────────────────────────────────────────
  const exportExcel = async () => {
    if (!orderRows.length || !delivery) { toast.error('No selected items to export'); return }
    setExportingXlsx(true)
    try {
      const grouped = buildGroups(orderRows)
      const delivDay  = delivery.date.toLocaleDateString('en-US', { weekday:'long' })
      const delivDate = delivery.date.toLocaleDateString('en-US', { day:'numeric', month:'long', year:'numeric' })
      await exportOrderExcel(grouped, {
        resortName,
        deliveryLabel: `${delivDay} · ${delivDate}`,
        filename: `Order_${delivDay}_${delivery.date.toISOString().split('T')[0]}.xlsx`,
      })
      toast.success('Excel exported')
    } catch (err) { toast.error('Export failed: ' + err.message) }
    setExportingXlsx(false)
  }

  // ── Save order ─────────────────────────────────────────────
  const saveOrder = async () => {
    const toOrder = visibleRows.filter(r => r.ordered > 0)
    if (!toOrder.length) { toast.error('No items to save'); return }
    if (!delivery) return
    setSaving(true)
    try {
      const { data: order } = await supabase.from('order_history').insert({
        delivery_date: delivery.date.toISOString().split('T')[0],
        delivery_day:  delivery.date.toLocaleDateString('en-US', { weekday:'long' }),
        status: 'pending', created_by: 'System', notes: `Order for ${delivery.label}`,
      }).select().single()
      await supabase.from('order_history_items').insert(
        toOrder.map(r => ({ order_id: order.id, item_id: r.id?.startsWith?.('pending') ? null : r.id, part_number: r.part_number, item_name: r.name, store_name: r.store, unit: r.unit, ordered_qty: r.ordered, received_qty: 0 }))
      )
      toast.success(`Order saved — ${toOrder.length} items`)
    } catch (err) { toast.error(err.message) }
    setSaving(false)
  }

  // ── History ────────────────────────────────────────────────
  const loadHistory = async () => {
    setHistLoad(true)
    const { data } = await supabase.from('order_history').select('*').order('created_at', { ascending: false }).limit(30)
    setHistory(data || []); setHistLoad(false)
  }
  const loadExpandedItems = async (id) => {
    if (expandedItems[id]) { setExpanded(expanded === id ? null : id); return }
    const { data } = await supabase.from('order_history_items').select('*').eq('order_id', id)
    setExpandedItems(p => ({ ...p, [id]: data || [] })); setExpanded(id)
  }
  const markReceived = async (orderId) => {
    const oItems = expandedItems[orderId] || []
    if (!confirm('Mark all as fully received? Stock will be updated.')) return
    setMarkingId(orderId)
    for (const oi of oItems) {
      if (!oi.item_id || !oi.ordered_qty) continue
      const { data: item } = await supabase.from('items').select('current_stock').eq('id', oi.item_id).single()
      if (!item) continue
      const newStock = Number(item.current_stock) + Number(oi.ordered_qty)
      await supabase.from('items').update({ current_stock: newStock }).eq('id', oi.item_id)
      await supabase.from('order_history_items').update({ received_qty: oi.ordered_qty }).eq('id', oi.id)
    }
    await supabase.from('order_history').update({ status: 'received' }).eq('id', orderId)
    setHistory(prev => prev.map(o => o.id === orderId ? { ...o, status: 'received' } : o))
    toast.success('Order received — stock updated!'); setMarkingId(null)
  }
  const markPartialReceived = async (orderId, itemId, receivedQty) => {
    await supabase.from('order_history_items').update({ received_qty: receivedQty }).eq('id', itemId)
    const updatedItems = (expandedItems[orderId] || []).map(i => i.id === itemId ? { ...i, received_qty: receivedQty } : i)
    setExpandedItems(p => ({ ...p, [orderId]: updatedItems }))
    const allReceived  = updatedItems.every(i => Number(i.received_qty) >= Number(i.ordered_qty))
    const someReceived = updatedItems.some(i => Number(i.received_qty) > 0)
    const newStatus = allReceived ? 'received' : someReceived ? 'partial' : 'pending'
    await supabase.from('order_history').update({ status: newStatus }).eq('id', orderId)
    setHistory(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o))
  }
  const switchToHistory = () => { setTab('history'); loadHistory() }

  // ── Delivery-day filter (live) ───────────────────────────────────────────
  //  Foreign items only arrive Monday; local items can arrive both days (mainly
  //  Thursday). Picking a day instantly narrows the list to what can actually
  //  be delivered that day — no regenerate needed.
  const visibleRows = useMemo(() => {
    // 'week' (whole-week order) and 'Monday'/'Thursday' (day-targeted) views.
    let list = (deliveryDay === 'Monday' || deliveryDay === 'Thursday')
      ? rows.filter(r => canDeliverOn(r.origin, deliveryDay))
      : rows
    if (catFilter) list = list.filter(r => (r.category || '') === catFilter)
    if (subFilter) list = list.filter(r => (r.store || '') === subFilter)
    if (needFilter === 'selected')   list = list.filter(r => r.selected)
    if (needFilter === 'unselected') list = list.filter(r => !r.selected)
    return list
  }, [rows, deliveryDay, catFilter, subFilter, needFilter])
  const { sorted: sortedRows, thProps } = useSort(visibleRows, null, 'asc')
  // Float selected (needed) rows to the top so they're easy to see/scan.
  const displayRows = useMemo(() =>
    [...sortedRows].sort((a, b) => (b.selected ? 1 : 0) - (a.selected ? 1 : 0)), [sortedRows])

  // Sub-category (store) options grouped by main category, derived from the data.
  const subOptions = useMemo(() => {
    const all = [...new Set(rows
      .filter(r => !catFilter || (r.category || '') === catFilter)
      .map(r => r.store).filter(Boolean))]
    return all.sort()
  }, [rows, catFilter])

  // Switch the targeted delivery day live (also re-dates the order header).
  const pickDeliveryDay = (day) => { setDeliveryDay(day); setDelivery(nextDeliveryFor(day)) }

  // Only SELECTED rows with a quantity make it into the order (faded/unselected
  // = not needed, so they're excluded from export & save).
  const orderRows        = visibleRows.filter(r => r.selected && r.ordered > 0)
  const toOrder          = orderRows
  const showPendingAlert = pendingItems.length > 0 && !pendingDismissed && rows.length > 0
  const pendingSources   = [...new Set(pendingItems.map(i => `${i.orderDay} · ${i.orderDate}`))]

  // Item search helpers (shared for both add modals)
  const filteredAllItems = allItems.filter(i =>
    !itemSearch || i.name.toLowerCase().includes(itemSearch.toLowerCase()) || i.part_number.toLowerCase().includes(itemSearch.toLowerCase())
  ).slice(0, 8)
  const filteredSavedItems = allItems.filter(i =>
    !savedItemSearch || i.name.toLowerCase().includes(savedItemSearch.toLowerCase()) || i.part_number.toLowerCase().includes(savedItemSearch.toLowerCase())
  ).slice(0, 8)

  // ── Manual Order handlers ───────────────────────────────────────
  const openManual = async () => { setTab('manual'); await loadAllItems() }
  const manualFiltered = allItems.filter(i =>
    !manualSearch || i.name.toLowerCase().includes(manualSearch.toLowerCase()) ||
    (i.part_number || '').toLowerCase().includes(manualSearch.toLowerCase())
  ).slice(0, 10)
  const addManual = (item) => {
    setManualRows(prev => {
      if (prev.some(r => r.id === item.id)) { toast('Already in the list', { icon: 'ℹ️' }); return prev }
      return [...prev, {
        id: item.id, part_number: item.part_number, name: item.name,
        store: item.stores?.name || '', category: item.stores?.category || '',
        unit: item.unit || thresholds.uom || 'pcs', pack: Number(item.pack_size) || 1,
        current_stock: item.current_stock ?? 0, avgWeekly: '', suggested: '',
        ordered: 1,
      }]
    })
    setManualSearch('')
  }
  const setManualQtyRow = (id, val) => { const n = parseFloat(val); setManualRows(prev => prev.map(r => r.id === id ? { ...r, ordered: isNaN(n) ? 0 : Math.max(0, n) } : r)) }
  const removeManual = (id) => setManualRows(prev => prev.filter(r => r.id !== id))

  const exportManual = async (kind) => {
    const list = manualRows.filter(r => Number(r.ordered) > 0)
    if (!list.length) { toast.error('Add at least one item with a quantity'); return }
    setManualExporting(true)
    try {
      const grouped = buildGroups(list)
      const dl = nextDelivery()
      const delivDay = dl.date.toLocaleDateString('en-US', { weekday: 'long' })
      const delivDate = dl.date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
      if (kind === 'pdf') {
        const { default: jsPDF }     = await import('jspdf')
        const { default: autoTable } = await import('jspdf-autotable')
        const doc = new jsPDF({ unit: 'mm', format: 'a4' })
        const cyan = [0, 174, 239]
        doc.setFillColor(...cyan); doc.rect(0, 0, 210, 28, 'F')
        doc.setTextColor(255,255,255); doc.setFontSize(18); doc.setFont('helvetica','bold')
        doc.text(resortName, 14, 12)
        doc.setFontSize(13); doc.setFont('helvetica','normal')
        doc.text('Manual Order', 14, 21)
        let y = 36
        for (const [grp, gItems] of Object.entries(grouped)) {
          doc.setTextColor(0); doc.setFontSize(11); doc.setFont('helvetica','bold')
          doc.text(grp || 'Unassigned', 14, y)
          autoTable(doc, {
            startY: y + 3,
            head: [['Part #','Item','Sub-Category','Unit','Order Qty']],
            body: gItems.map(i => [i.part_number, i.name, i.store, i.unit, i.ordered]),
            headStyles: { fillColor: cyan, fontSize: 8 }, styles: { fontSize: 8 },
            alternateRowStyles: { fillColor: [248,250,252] },
          })
          y = doc.lastAutoTable.finalY + 8
        }
        doc.save(`Manual_Order_${dl.date.toISOString().split('T')[0]}.pdf`)
      } else {
        await exportOrderExcel(grouped, {
          resortName, deliveryLabel: `Manual · ${delivDay} · ${delivDate}`,
          filename: `Manual_Order_${dl.date.toISOString().split('T')[0]}.xlsx`,
        })
      }
      toast.success('Manual order exported')
    } catch (err) { toast.error('Export failed: ' + err.message) }
    setManualExporting(false)
  }

  // ── JSX ────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Order Sheet</h1>
          {delivery && tab === 'generate' && <p className="page-sub">Next delivery: <strong className="text-[#00AEEF]">{delivery.label}</strong></p>}
        </div>
        <div className="flex gap-2 flex-wrap">
          {tab === 'generate' && rows.length > 0 && (
            <>
              <button onClick={() => setShowCSV(true)} className="btn-secondary btn-sm"><Upload className="w-4 h-4" /> Import CSV</button>
              <Button variant="secondary" onClick={openAddItem}><PlusCircle className="w-4 h-4" /> Add Item</Button>
              <Button variant="secondary" onClick={exportExcel} loading={exportingXlsx}><Download className="w-4 h-4" /> Download Excel</Button>
              <Button variant="secondary" onClick={exportPDF} loading={exportingPdf}><Download className="w-4 h-4" /> Download PDF</Button>
              <Button variant="secondary" onClick={saveOrder} loading={saving}><Save className="w-4 h-4" /> Save Order</Button>
            </>
          )}
          {tab === 'generate'
            ? <Button onClick={generate} loading={loading}><RefreshCw className="w-4 h-4" /> Generate</Button>
            : <Button onClick={() => setTab('generate')}>← Generate New</Button>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-700">
        {[{ key:'generate', label:'Generate Order' }, { key:'manual', label:'Manual Order' }, { key:'history', label:'Order History' }].map(({ key, label }) => (
          <button key={key} onClick={() => key === 'history' ? switchToHistory() : key === 'manual' ? openManual() : setTab(key)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${tab === key ? 'border-[#00AEEF] text-[#00AEEF]' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Generate tab ───────────────────────────────────── */}
      {tab === 'generate' && (
        <>
          {/* Generation mode + scope + delivery-day controls */}
          <div className="card-sm space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              {/* By Pattern / By Usage */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 uppercase tracking-wide">Generate</span>
                <div className="flex gap-1 bg-slate-800 border border-slate-700 rounded-lg p-1">
                  {[
                    { key:'pattern', label:'By Pattern', hint:'general order list' },
                    { key:'usage',   label:'By Usage',   hint:'from usage history' },
                  ].map(m => (
                    <button key={m.key} onClick={() => setOrderMode(m.key)} title={m.hint}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${orderMode === m.key ? 'bg-[#00AEEF] text-white' : 'text-slate-400 hover:text-slate-100'}`}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-slate-500 hidden sm:inline">
                  {orderMode === 'pattern' ? 'standard list from boat-note ordering pattern' : 'calculated from issuance usage history'}
                </span>
              </div>
              {/* Delivery day */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 uppercase tracking-wide">Delivery</span>
                <div className="flex gap-1 bg-slate-800 border border-slate-700 rounded-lg p-1">
                  {['week','Monday','Thursday'].map(d => (
                    <button key={d} onClick={() => pickDeliveryDay(d)}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${deliveryDay === d ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
                      {d === 'week' ? 'Whole Week' : d}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Category filter + export layout */}
            <div className="flex items-center justify-between gap-3 flex-wrap border-t border-slate-700/50 pt-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-400 uppercase tracking-wide">Category</span>
                <div className="flex gap-1 bg-slate-800 border border-slate-700 rounded-lg p-1">
                  {[{k:'',l:'All'}, {k:'Beverage',l:'Beverage'}, {k:'Food',l:'Food'}, {k:'General',l:'General'}].map(c => (
                    <button key={c.k} onClick={() => setCatFilter(c.k)}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${catFilter === c.k ? 'bg-[#00AEEF] text-white' : 'text-slate-400 hover:text-slate-100'}`}>
                      {c.l}
                    </button>
                  ))}
                </div>
                {subOptions.length > 0 && (
                  <select value={subFilter} onChange={e => setSubFilter(e.target.value)} className="input text-sm w-auto py-1.5">
                    <option value="">All sub-categories</option>
                    {subOptions.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 uppercase tracking-wide">Export layout</span>
                <div className="flex gap-1 bg-slate-800 border border-slate-700 rounded-lg p-1">
                  {[{k:'normal',l:'Normal'}, {k:'category',l:'By Category'}].map(m => (
                    <button key={m.k} onClick={() => setExportMode(m.k)}
                      title={m.k === 'category' ? 'Beverage → Food → General' : 'Regular sorting by sub-category'}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${exportMode === m.k ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
                      {m.l}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Order quantity controls: backup weeks · subtract stock */}
            <div className="flex items-center gap-4 flex-wrap border-t border-slate-700/50 pt-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 uppercase tracking-wide">Backup weeks</span>
                <select value={backupWeeks} onChange={e => setBackupWeeks(Number(e.target.value))} className="input text-sm w-auto py-1.5">
                  <option value={0}>This week only</option>
                  <option value={1}>+1 week backup</option>
                  <option value={2}>+2 weeks backup</option>
                  <option value={3}>+3 weeks backup</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={subtractStock} onChange={e => setSubtractStock(e.target.checked)} className="accent-teal-500 w-4 h-4" />
                Subtract current stock
              </label>
              <span className="text-[11px] text-slate-500">Order rounds up to whole packs · edit any qty / pack below.</span>
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap border-t border-slate-700/50 pt-3">
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={storeOnly} onChange={e => setStoreOnly(e.target.checked)} className="accent-teal-500 w-4 h-4" />
                <strong>STORE items only</strong> <span className="text-slate-500">— ordered from boat-note history</span>
              </label>
              <div className="flex items-center gap-2 text-xs">
                {boatStats && <span className="text-slate-400">{boatStats.count} store items · ~{boatStats.weeks}w history</span>}
                <Badge variant="blue">Foreign → Mon only</Badge>
                <Badge variant="green">Local → Thu (also Mon)</Badge>
              </div>
            </div>
          </div>
          {!rows.length && !loading && (
            <div className="card text-center py-20 text-slate-500">
              <ShoppingCart className="w-14 h-14 mx-auto mb-4 opacity-20" />
              <p className="font-medium text-lg">No order generated yet</p>
              <p className="text-sm mt-1">Click <strong>"Generate"</strong> to auto-calculate from usage history.</p>
            </div>
          )}
          {loading && <div className="flex justify-center py-20"><div className="w-12 h-12 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" /></div>}

          {rows.length > 0 && !loading && (
            <>
              {/* Undelivered items alert */}
              {showPendingAlert && (
                <div className="card border border-orange-600/50 bg-orange-900/15">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-orange-900/40 rounded-xl flex items-center justify-center shrink-0">
                      <PackageX className="w-5 h-5 text-orange-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-orange-300 text-base">{pendingItems.length} item{pendingItems.length !== 1 ? 's' : ''} from previous orders didn't arrive</p>
                      <p className="text-sm text-orange-200/70 mt-0.5">From: {pendingSources.join(' · ')}</p>
                      <div className="mt-3 space-y-1.5 max-h-40 overflow-y-auto">
                        {pendingItems.map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between gap-4 text-sm">
                            <span className="text-slate-200 truncate">{item.item_name}</span>
                            <span className="text-orange-300 font-bold shrink-0">shortfall {item.shortfall} {item.unit}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2 mt-4 flex-wrap">
                        <Button onClick={addPendingToOrder}><CheckCircle2 className="w-4 h-4" /> Add {pendingItems.length} Undelivered to This Order</Button>
                        <Button variant="secondary" onClick={() => setPendingDismissed(true)}>Skip</Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="card-sm text-center"><p className="text-2xl font-bold text-[#00AEEF]">{visibleRows.length}</p><p className="text-slate-400 text-sm mt-1">Items</p></div>
                <div className="card-sm text-center"><p className="text-2xl font-bold text-[#00AEEF]">{toOrder.reduce((s, r) => s + r.ordered, 0)}</p><p className="text-slate-400 text-sm mt-1">Total Units</p></div>
                <div className="card-sm text-center"><p className="text-sm font-medium text-green-400">{visibleRows.filter(r => r._manuallyAdded).length} manually added</p><p className="text-slate-400 text-xs mt-1">items</p></div>
                <div className="card-sm text-center">
                  <p className="font-medium text-slate-100">{delivery?.date.toLocaleDateString('en-US', { weekday:'long' })}</p>
                  <p className="text-slate-400 text-xs mt-1">{delivery?.date.toLocaleDateString('en-US', { day:'numeric', month:'short', year:'numeric' })}</p>
                </div>
              </div>

              {/* Order table */}
              <div className="card">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <p className="text-xs text-slate-400">
                    Order = Avg/Wk × {1 + backupWeeks}wk{subtractStock ? ' − Stock' : ''}, capped by category max, rounded to packs.
                    {' '}<span className="text-slate-200">Highlighted = needed (in order)</span>, <span className="opacity-50">faded = not needed</span>.
                  </p>
                  <Button onClick={openAddItem} variant="secondary"><PlusCircle className="w-4 h-4" /> Add Item Manually</Button>
                </div>
                {/* Selection toolbar */}
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  <span className="text-xs text-slate-400 uppercase tracking-wide">Select</span>
                  <button onClick={selectAll} className="btn-secondary btn-sm">Select All</button>
                  <button onClick={selectLowStock} className="btn-secondary btn-sm">Select Low Stock</button>
                  <button onClick={clearSelection} className="btn-ghost btn-sm">Clear</button>
                  <span className="mx-1 text-slate-600">·</span>
                  <span className="text-xs text-slate-400 uppercase tracking-wide">Show</span>
                  <div className="flex gap-1 bg-slate-800 border border-slate-700 rounded-lg p-1">
                    {[{k:'all',l:'All'},{k:'selected',l:'Needed'},{k:'unselected',l:'Not needed'}].map(o => (
                      <button key={o.k} onClick={() => setNeedFilter(o.k)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${needFilter === o.k ? 'bg-[#00AEEF] text-white' : 'text-slate-400 hover:text-slate-100'}`}>
                        {o.l}
                      </button>
                    ))}
                  </div>
                  <span className="ml-auto text-xs text-slate-400"><strong className="text-teal-300">{orderRows.length}</strong> selected · {orderRows.reduce((s,r)=>s+Number(r.ordered||0),0)} units</span>
                </div>
                <Table>
                  <Thead><tr>
                    <Th>✓</Th>
                    <Th {...thProps('part_number')}>Part #</Th>
                    <Th {...thProps('name')}>Item Name</Th>
                    <Th {...thProps('store')}>Sub-Category</Th>
                    <Th {...thProps('origin')}>Origin · Day</Th>
                    <Th {...thProps('unit')}>Unit</Th>
                    <Th {...thProps('pack')}>Pack</Th>
                    <Th {...thProps('current_stock')}>In Stock</Th>
                    <Th {...thProps('avgWeekly')}>Avg/Wk</Th>
                    <Th {...thProps('suggested')}>Suggested</Th>
                    <Th {...thProps('ordered')}>Order Qty</Th>
                    <Th></Th>
                  </tr></Thead>
                  <Tbody>
                    {displayRows.map(row => (
                      <Tr key={row.id}
                        className={[
                          !row.selected ? 'opacity-40' : '',
                          row._fromPending ? 'bg-orange-900/10' : '',
                          row._manuallyAdded && !row._fromPending ? 'bg-blue-900/10' : '',
                        ].join(' ')}>
                        <Td>
                          <input type="checkbox" checked={!!row.selected} onChange={() => toggleSelect(row.id)}
                            title={row.selected ? 'Needed — included in order' : 'Not needed — excluded'}
                            className="accent-teal-500 w-4 h-4" />
                        </Td>
                        <Td className="font-mono text-xs text-slate-300">{row.part_number}</Td>
                        <Td className="max-w-xs">
                          <p className={`text-sm font-medium truncate ${row._fromPending ? 'text-orange-200' : row._manuallyAdded ? 'text-blue-200' : 'text-slate-100'}`}>{row.name}</p>
                          {row._pendingNote && <p className="text-[10px] text-slate-400 mt-0.5 truncate">{row._pendingNote}</p>}
                        </Td>
                        <Td className="text-xs text-slate-400">{row.store}</Td>
                        <Td>
                          <Badge variant={row.origin === 'local' ? 'green' : 'blue'}>
                            {deliveryLabelFor(row.origin)}
                          </Badge>
                        </Td>
                        <Td className="text-xs text-slate-400">{row.unit}</Td>
                        <Td>
                          <input type="number" min="1" step="1" value={row.pack || 1} onChange={e => setPack(row.id, e.target.value)}
                            title="Pack size — order rounds up to whole packs"
                            className="w-14 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-center text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-[#00AEEF]" />
                        </Td>
                        <Td className={Number(row.current_stock) <= Number(row.min_stock) ? 'text-red-400 font-semibold' : 'text-slate-300'}>{row.current_stock}</Td>
                        <Td className="text-slate-300">{row.avgWeekly || '—'}</Td>
                        <Td><Badge variant={row._fromPending ? 'orange' : row._manuallyAdded ? 'blue' : 'teal'}>{row.suggested}</Badge></Td>
                        <Td>
                          <div className="flex items-center gap-1">
                            <button onClick={() => adjustQty(row.id, -1)} className="w-7 h-7 flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300"><Minus className="w-3 h-3" /></button>
                            <input type="number" min="0" value={row.ordered} onChange={e => setQty(row.id, e.target.value)}
                              className="w-16 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-center text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-[#00AEEF]" />
                            <button onClick={() => adjustQty(row.id, 1)} className="w-7 h-7 flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300"><Plus className="w-3 h-3" /></button>
                          </div>
                        </Td>
                        <Td>
                          <button onClick={() => removeRow(row.id)} className="p-1 text-slate-600 hover:text-red-400 rounded-lg transition-colors" title="Remove from order">
                            <X className="w-4 h-4" />
                          </button>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </div>
            </>
          )}
        </>
      )}

      {/* ── History tab ─────────────────────────────────────── */}
      {/* ── Manual Order tab ─────────────────────────────────── */}
      {tab === 'manual' && (
        <div className="space-y-4">
          <div className="card-sm">
            <p className="text-sm text-slate-300 font-medium mb-1">Build an order by hand</p>
            <p className="text-xs text-slate-500">Search the inventory, add the items you need, set quantities, then export the list to Excel or PDF. Uses the same Normal / By-Category export layout selected above.</p>
          </div>

          {/* Search to add */}
          <div className="card">
            <label className="block text-sm font-medium text-slate-300 mb-1">Add item</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input className="input pl-9 text-sm" placeholder="Search by name or part #…" value={manualSearch}
                onChange={e => setManualSearch(e.target.value)} />
              {manualSearch && manualFiltered.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-600 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                  {manualFiltered.map(item => (
                    <button key={item.id} onClick={() => addManual(item)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-slate-700 text-left text-sm">
                      <span className="font-mono text-xs text-[#00AEEF] w-20 shrink-0">{item.part_number}</span>
                      <span className="flex-1 text-slate-200 truncate">{item.name}</span>
                      <span className="text-slate-500 text-xs shrink-0">{item.stores?.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {manualRows.length === 0 ? (
            <div className="card text-center py-16 text-slate-500">
              <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="font-medium">No items added yet</p>
              <p className="text-sm mt-1">Search above to add items to your manual order.</p>
            </div>
          ) : (
            <div className="card">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <p className="text-xs text-slate-400"><strong className="text-teal-300">{manualRows.filter(r => Number(r.ordered) > 0).length}</strong> items · {manualRows.reduce((sum, r) => sum + Number(r.ordered || 0), 0)} units</p>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="secondary" onClick={() => exportManual('xlsx')} loading={manualExporting}><Download className="w-4 h-4" /> Export Excel</Button>
                  <Button variant="secondary" onClick={() => exportManual('pdf')} loading={manualExporting}><Download className="w-4 h-4" /> Export PDF</Button>
                  <Button variant="ghost" onClick={() => setManualRows([])}>Clear</Button>
                </div>
              </div>
              <Table>
                <Thead><tr><Th>Part #</Th><Th>Item Name</Th><Th>Sub-Category</Th><Th>Unit</Th><Th>Order Qty</Th><Th></Th></tr></Thead>
                <Tbody>
                  {manualRows.map(row => (
                    <Tr key={row.id}>
                      <Td className="font-mono text-xs text-slate-300">{row.part_number}</Td>
                      <Td className="text-sm font-medium text-slate-100">{row.name}</Td>
                      <Td className="text-xs text-slate-400">{row.store}{row.category ? ` · ${row.category}` : ''}</Td>
                      <Td className="text-xs text-slate-400">{row.unit}</Td>
                      <Td>
                        <input type="number" min="0" value={row.ordered} onChange={e => setManualQtyRow(row.id, e.target.value)}
                          className="w-20 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-center text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-[#00AEEF]" />
                      </Td>
                      <Td><button onClick={() => removeManual(row.id)} className="p-1 text-slate-600 hover:text-red-400" title="Remove"><X className="w-4 h-4" /></button></Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-3">
          {histLoad ? (
            <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" /></div>
          ) : history.length === 0 ? (
            <div className="card text-center py-16 text-slate-500">
              <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="font-medium">No saved orders yet</p>
            </div>
          ) : history.map(order => {
            const oItems = expandedItems[order.id] || []
            const isExp  = expanded === order.id
            const undeliveredCount = oItems.filter(i => Number(i.received_qty) < Number(i.ordered_qty)).length
            return (
              <div key={order.id} className="card border border-slate-700/40">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <button className="flex items-center gap-3 text-left flex-1" onClick={() => loadExpandedItems(order.id)}>
                    {isExp ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-slate-100">Order for {order.delivery_day} · {order.delivery_date}</p>
                        <Badge variant={STATUS_BADGE[order.status] || 'gray'}>{order.status}</Badge>
                        {isExp && undeliveredCount > 0 && order.status !== 'received' && (
                          <span className="text-xs text-orange-400 flex items-center gap-1"><PackageX className="w-3 h-3" />{undeliveredCount} not received</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">Saved {new Date(order.created_at).toLocaleDateString()}</p>
                    </div>
                  </button>
                  <div className="flex gap-2 flex-wrap">
                    {/* Add item to this saved order */}
                    <button onClick={() => openAddToSavedOrder(order.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-400 border border-blue-700/30 bg-blue-900/10 hover:bg-blue-900/30 rounded-lg transition-colors">
                      <PlusCircle className="w-3.5 h-3.5" /> Add Item
                    </button>
                    {order.status !== 'received' && order.status !== 'cancelled' && (
                      <Button onClick={() => { loadExpandedItems(order.id); setTimeout(() => markReceived(order.id), 600) }}
                        loading={markingId === order.id} variant="secondary">
                        ✓ Mark All Received
                      </Button>
                    )}
                  </div>
                </div>

                {isExp && oItems.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-700/40">
                    <Table>
                      <Thead><tr><Th>Part #</Th><Th>Item</Th><Th>Store</Th><Th>Ordered</Th><Th>Received</Th><Th>Status</Th></tr></Thead>
                      <Tbody>
                        {oItems.map(oi => {
                          const shortfall   = Number(oi.ordered_qty) - Number(oi.received_qty)
                          const isReceived  = shortfall <= 0
                          return (
                            <Tr key={oi.id} className={isReceived ? 'opacity-60' : ''}>
                              <Td className="font-mono text-xs text-slate-300">{oi.part_number}</Td>
                              <Td className="font-medium text-slate-100 max-w-xs truncate">{oi.item_name}</Td>
                              <Td className="text-slate-400 text-xs">{oi.store_name}</Td>
                              <Td className="text-teal-400 font-semibold">{oi.ordered_qty} <span className="text-slate-500 text-xs font-normal">{oi.unit}</span></Td>
                              <Td>
                                {order.status !== 'received' ? (
                                  <input type="number" min="0" max={oi.ordered_qty} defaultValue={oi.received_qty}
                                    className="w-20 input text-xs py-1 text-center"
                                    onBlur={e => { const v = Number(e.target.value); if (v !== Number(oi.received_qty)) markPartialReceived(order.id, oi.id, v) }} />
                                ) : (
                                  <span className="text-green-400 font-semibold">{oi.received_qty} <span className="text-slate-500 text-xs font-normal">{oi.unit}</span></span>
                                )}
                              </Td>
                              <Td>
                                {isReceived ? <Badge variant="green">Received</Badge>
                                  : shortfall === Number(oi.ordered_qty) ? <Badge variant="yellow">Pending</Badge>
                                  : <Badge variant="orange">Partial ({shortfall} missing)</Badge>}
                              </Td>
                            </Tr>
                          )
                        })}
                      </Tbody>
                    </Table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ══ MODAL: Add item to current week's order ══════════ */}
      {showAddItem && (
        <Modal isOpen onClose={() => setShowAddItem(false)} title="Add Item to This Order" size="sm"
          footer={<><Button variant="secondary" onClick={() => setShowAddItem(false)}>Cancel</Button><Button onClick={confirmAddItem}>Add to Order</Button></>}>
          <div className="space-y-4">
            {/* Item search */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Item *</label>
              {selectedItem ? (
                <div className="input bg-slate-700/50 flex items-center gap-2">
                  <span className="font-mono text-xs text-[#00AEEF]">{selectedItem.part_number}</span>
                  <span className="flex-1 text-slate-100">{selectedItem.name}</span>
                  <span className="text-slate-400 text-xs">{selectedItem.unit}</span>
                  <button onClick={() => { setSelectedItem(null); setItemSearch('') }}><X className="w-4 h-4 text-slate-400" /></button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input className="input pl-9 text-sm" placeholder="Search by name or part #…" value={itemSearch}
                    onChange={e => setItemSearch(e.target.value)} autoFocus />
                  {filteredAllItems.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-600 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                      {filteredAllItems.map(item => (
                        <button key={item.id} onClick={() => { setSelectedItem(item); setItemSearch('') }}
                          className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-slate-700 text-left text-sm">
                          <span className="font-mono text-xs text-[#00AEEF] w-20 shrink-0">{item.part_number}</span>
                          <span className="flex-1 text-slate-200 truncate">{item.name}</span>
                          <span className="text-slate-500 text-xs shrink-0">{item.stores?.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <Input label={`Quantity to Order *${selectedItem ? ` (${selectedItem.unit})` : ''}`}
              type="number" min="1" value={manualQty} onChange={e => setManualQty(e.target.value)}
              placeholder="How many to add to order?" />
            {selectedItem && (
              <div className="text-xs text-slate-400 bg-slate-700/30 rounded-lg p-2.5">
                Current stock: <strong className="text-slate-200">{selectedItem.current_stock} {selectedItem.unit}</strong> · Store: {selectedItem.stores?.name}
              </div>
            )}
            <Input label="Note (optional)" value={manualNote} onChange={e => setManualNote(e.target.value)}
              placeholder="e.g. Chef requested extra stock" />
          </div>
        </Modal>
      )}

      {/* ══ MODAL: Add item to saved order (history) ════════ */}
      {showAddToOrder && (
        <Modal isOpen onClose={() => setShowAddToOrder(null)} title="Add Item to Saved Order" size="sm"
          footer={<><Button variant="secondary" onClick={() => setShowAddToOrder(null)}>Cancel</Button><Button onClick={confirmAddToSavedOrder} loading={addingToOrder}>Add to Order</Button></>}>
          <div className="space-y-4">
            <div className="bg-blue-900/20 border border-blue-700/30 rounded-xl p-3 text-sm text-blue-300">
              The item will be added to this saved order. You can mark it received later.
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Item *</label>
              {savedItem ? (
                <div className="input bg-slate-700/50 flex items-center gap-2">
                  <span className="font-mono text-xs text-[#00AEEF]">{savedItem.part_number}</span>
                  <span className="flex-1 text-slate-100">{savedItem.name}</span>
                  <span className="text-slate-400 text-xs">{savedItem.unit}</span>
                  <button onClick={() => { setSavedItem(null); setSavedItemSearch('') }}><X className="w-4 h-4 text-slate-400" /></button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input className="input pl-9 text-sm" placeholder="Search by name or part #…" value={savedItemSearch}
                    onChange={e => setSavedItemSearch(e.target.value)} autoFocus />
                  {filteredSavedItems.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-600 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                      {filteredSavedItems.map(item => (
                        <button key={item.id} onClick={() => { setSavedItem(item); setSavedItemSearch('') }}
                          className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-slate-700 text-left text-sm">
                          <span className="font-mono text-xs text-[#00AEEF] w-20 shrink-0">{item.part_number}</span>
                          <span className="flex-1 text-slate-200 truncate">{item.name}</span>
                          <span className="text-slate-500 text-xs shrink-0">{item.stores?.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <Input label={`Quantity *${savedItem ? ` (${savedItem.unit})` : ''}`}
              type="number" min="1" value={savedQty} onChange={e => setSavedQty(e.target.value)} />
            <Input label="Note (optional)" value={savedNote} onChange={e => setSavedNote(e.target.value)} placeholder="Reason for adding…" />
          </div>
        </Modal>
      )}

      {/* CSV import */}
      {showCSV && <CSVImportModal config={CSV_CONFIGS.order_items} onClose={() => setShowCSV(false)} onImported={() => { setTab('history'); loadHistory() }} />}
    </div>
  )
}
