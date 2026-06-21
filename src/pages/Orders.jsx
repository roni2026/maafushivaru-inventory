import { useState, useCallback } from 'react'
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
function weekRange(weeksBack = 0) {
  const now = new Date()
  const toDate = new Date(now); toDate.setDate(toDate.getDate() - weeksBack * 7)
  const frDate = new Date(toDate); frDate.setDate(frDate.getDate() - 7)
  return { from: frDate.toISOString().split('T')[0], to: toDate.toISOString().split('T')[0] }
}

const STATUS_BADGE = { pending:'yellow', partial:'orange', received:'green', cancelled:'red' }

export default function Orders() {
  const [tab,       setTab]      = useState('generate')
  const [rows,      setRows]     = useState([])
  const [delivery,  setDelivery] = useState(null)
  const [loading,   setLoading]  = useState(false)
  const [exporting, setExporting]= useState(false)
  const [saving,    setSaving]   = useState(false)
  const [resortName,setResortName]=useState('Outrigger Maafushivaru Resort')
  const [showCSV,   setShowCSV]  = useState(false)

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

  // ── Add item to saved order (history) ─────────────────────
  const [showAddToOrder, setShowAddToOrder]   = useState(null) // orderId
  const [savedItemSearch,setSavedItemSearch]  = useState('')
  const [savedItem,      setSavedItem]        = useState(null)
  const [savedQty,       setSavedQty]         = useState('')
  const [savedNote,      setSavedNote]        = useState('')
  const [addingToOrder,  setAddingToOrder]    = useState(false)

  // ── Load all items for manual add ─────────────────────────
  const loadAllItems = async () => {
    if (allItems.length) return
    const { data } = await selectAll(() => supabase.from('items').select('id,name,part_number,unit,current_stock,stores(name)').eq('active', true).order('name'))
    setAllItems(data || [])
  }

  // ── Check undelivered from previous orders ─────────────────
  const checkUndeliveredItems = useCallback(async () => {
    const { data: oldOrders } = await supabase.from('order_history')
      .select('id,delivery_date,delivery_day,status')
      .in('status', ['pending','partial'])
      .order('created_at', { ascending: false }).limit(3)
    if (!oldOrders?.length) { setPendingItems([]); return }
    const undelivered = []
    for (const order of oldOrders) {
      const { data: oItems } = await supabase.from('order_history_items').select('*').eq('order_id', order.id)
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
      const { data: settings } = await supabase.from('settings').select('key,value')
      const smap = (settings || []).reduce((a, s) => ({ ...a, [s.key]: s.value }), {})
      if (smap.resort_name) setResortName(smap.resort_name)
      const { data: items } = await selectAll(() => supabase.from('items').select('*, stores(name,category)').eq('active', true))
      const tw = weekRange(0); const lw = weekRange(1)
      const { data: thisIss } = await selectAll(() => supabase.from('issuances').select('item_id,quantity_issued').gte('date', tw.from).lte('date', tw.to))
      const { data: lastIss } = await selectAll(() => supabase.from('issuances').select('item_id,quantity_issued').gte('date', lw.from).lte('date', lw.to))
      const sum = (list, id) => (list || []).filter(i => i.item_id === id).reduce((s, i) => s + Number(i.quantity_issued), 0)
      const orderRows = (items || []).map(item => {
        const thisTotal = sum(thisIss, item.id); const lastTotal = sum(lastIss, item.id)
        const avgWeekly = (thisTotal + lastTotal) / 2
        const suggested = Math.max(0, Math.ceil(avgWeekly * 2 - Number(item.current_stock)))
        return { id: item.id, part_number: item.part_number, name: item.name, store: item.stores?.name || '', category: item.stores?.category || '', unit: item.unit, current_stock: item.current_stock, min_stock: item.min_stock, thisWeek: thisTotal, lastWeek: lastTotal, avgWeekly: Math.round(avgWeekly * 10) / 10, suggested, ordered: suggested, _fromPending: false, _pendingNote: '', _manuallyAdded: false }
      }).filter(r => r.suggested > 0 || r.current_stock <= r.min_stock)
        .sort((a, b) => a.store.localeCompare(b.store) || a.name.localeCompare(b.name))
      setRows(orderRows); setDelivery(nextDelivery())
      await checkUndeliveredItems()
    } catch (err) { toast.error('Failed: ' + err.message) }
    setLoading(false)
  }, [checkUndeliveredItems])

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
  const adjustQty = (id, delta) => setRows(prev => prev.map(r => r.id === id ? { ...r, ordered: Math.max(0, (r.ordered || 0) + delta) } : r))
  const setQty    = (id, val) => { const n = parseInt(val, 10); if (!isNaN(n) && n >= 0) setRows(prev => prev.map(r => r.id === id ? { ...r, ordered: n } : r)) }
  const removeRow = (id) => { setRows(prev => prev.filter(r => r.id !== id)); toast.success('Item removed from order') }

  // ── Export PDF ─────────────────────────────────────────────
  const exportPDF = async () => {
    if (!rows.length || !delivery) return
    setExporting(true)
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
      const grouped = rows.reduce((acc, r) => { (acc[r.store] = acc[r.store] || []).push(r); return acc }, {})
      let y = 36
      for (const [store, items] of Object.entries(grouped)) {
        doc.setTextColor(0); doc.setFontSize(11); doc.setFont('helvetica','bold')
        doc.text(store || 'Unassigned', 14, y)
        autoTable(doc, {
          startY: y + 3,
          head: [['Part #','Item','Unit','In Stock','Avg/Wk','Suggested','Order Qty','Notes']],
          body: items.map(i => [i.part_number, i.name, i.unit, i.current_stock, i.avgWeekly, i.suggested, i.ordered, i._pendingNote || (i._manuallyAdded ? 'Manual' : '')]),
          headStyles: { fillColor: cyan, fontSize: 8 }, styles: { fontSize: 8 },
          alternateRowStyles: { fillColor: [248,250,252] }, columnStyles: { 7: { cellWidth: 35, fontSize: 7 } },
        })
        y = doc.lastAutoTable.finalY + 8
      }
      doc.save(`Order_${delivDay}_${delivery.date.toISOString().split('T')[0]}.pdf`)
      toast.success('PDF exported')
    } catch (err) { toast.error('Export failed: ' + err.message) }
    setExporting(false)
  }

  // ── Export styled Excel ────────────────────────────────────────────────────
  const exportExcel = async () => {
    if (!rows.length || !delivery) return
    setExporting(true)
    try {
      const grouped = rows.reduce((acc, r) => { (acc[r.store] = acc[r.store] || []).push(r); return acc }, {})
      const delivDay  = delivery.date.toLocaleDateString('en-US', { weekday:'long' })
      const delivDate = delivery.date.toLocaleDateString('en-US', { day:'numeric', month:'long', year:'numeric' })
      await exportOrderExcel(grouped, {
        resortName,
        deliveryLabel: `${delivDay} · ${delivDate}`,
        filename: `Order_${delivDay}_${delivery.date.toISOString().split('T')[0]}.xlsx`,
      })
      toast.success('Excel exported')
    } catch (err) { toast.error('Export failed: ' + err.message) }
    setExporting(false)
  }

  // ── Save order ─────────────────────────────────────────────
  const saveOrder = async () => {
    const toOrder = rows.filter(r => r.ordered > 0)
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

  const toOrder          = rows.filter(r => r.ordered > 0)
  const showPendingAlert = pendingItems.length > 0 && !pendingDismissed && rows.length > 0
  const pendingSources   = [...new Set(pendingItems.map(i => `${i.orderDay} · ${i.orderDate}`))]

  // Item search helpers (shared for both add modals)
  const filteredAllItems = allItems.filter(i =>
    !itemSearch || i.name.toLowerCase().includes(itemSearch.toLowerCase()) || i.part_number.toLowerCase().includes(itemSearch.toLowerCase())
  ).slice(0, 8)
  const filteredSavedItems = allItems.filter(i =>
    !savedItemSearch || i.name.toLowerCase().includes(savedItemSearch.toLowerCase()) || i.part_number.toLowerCase().includes(savedItemSearch.toLowerCase())
  ).slice(0, 8)

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
              <Button variant="secondary" onClick={exportExcel} loading={exporting}><Download className="w-4 h-4" /> Excel</Button>
              <Button variant="secondary" onClick={exportPDF} loading={exporting}><Download className="w-4 h-4" /> PDF</Button>
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
        {[{ key:'generate', label:'Generate Order' }, { key:'history', label:'Order History' }].map(({ key, label }) => (
          <button key={key} onClick={() => key === 'history' ? switchToHistory() : setTab(key)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${tab === key ? 'border-[#00AEEF] text-[#00AEEF]' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Generate tab ───────────────────────────────────── */}
      {tab === 'generate' && (
        <>
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
                <div className="card-sm text-center"><p className="text-2xl font-bold text-[#00AEEF]">{rows.length}</p><p className="text-slate-400 text-sm mt-1">Items</p></div>
                <div className="card-sm text-center"><p className="text-2xl font-bold text-[#00AEEF]">{toOrder.reduce((s, r) => s + r.ordered, 0)}</p><p className="text-slate-400 text-sm mt-1">Total Units</p></div>
                <div className="card-sm text-center"><p className="text-sm font-medium text-green-400">{rows.filter(r => r._manuallyAdded).length} manually added</p><p className="text-slate-400 text-xs mt-1">items</p></div>
                <div className="card-sm text-center">
                  <p className="font-medium text-slate-100">{delivery?.date.toLocaleDateString('en-US', { weekday:'long' })}</p>
                  <p className="text-slate-400 text-xs mt-1">{delivery?.date.toLocaleDateString('en-US', { day:'numeric', month:'short', year:'numeric' })}</p>
                </div>
              </div>

              {/* Order table */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-slate-400">Suggested = (Avg/Wk × 2) − Stock. <span className="text-orange-300">Orange</span> = undelivered carried over. <span className="text-blue-400">Blue</span> = manually added.</p>
                  <Button onClick={openAddItem} variant="secondary"><PlusCircle className="w-4 h-4" /> Add Item Manually</Button>
                </div>
                <Table>
                  <Thead><tr>
                    <Th>Part #</Th><Th>Item Name</Th><Th>Store</Th><Th>Unit</Th><Th>In Stock</Th><Th>Avg/Wk</Th><Th>Suggested</Th><Th>Order Qty</Th><Th></Th>
                  </tr></Thead>
                  <Tbody>
                    {rows.map(row => (
                      <Tr key={row.id}
                        className={[
                          row.ordered === 0 ? 'opacity-40' : '',
                          row._fromPending ? 'bg-orange-900/10' : '',
                          row._manuallyAdded && !row._fromPending ? 'bg-blue-900/10' : '',
                        ].join(' ')}>
                        <Td className="font-mono text-xs text-slate-300">{row.part_number}</Td>
                        <Td className="max-w-xs">
                          <p className={`text-sm font-medium truncate ${row._fromPending ? 'text-orange-200' : row._manuallyAdded ? 'text-blue-200' : 'text-slate-100'}`}>{row.name}</p>
                          {row._pendingNote && <p className="text-[10px] text-slate-400 mt-0.5 truncate">{row._pendingNote}</p>}
                        </Td>
                        <Td className="text-xs text-slate-400">{row.store}</Td>
                        <Td className="text-xs text-slate-400">{row.unit}</Td>
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
