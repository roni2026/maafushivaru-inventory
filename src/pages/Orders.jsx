import { useState, useCallback, useEffect, useMemo } from 'react'
import { supabase, selectAll } from '../lib/supabase'
import {
  ShoppingCart, Download, Save, Minus, Plus, ChevronDown, ChevronRight,
  Search, X, PlusCircle, PackageX, FileSpreadsheet, FileText, Mail, Calendar,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import { exportOrderExcel } from '../lib/excelExport'

// ── Constants ─────────────────────────────────────────────────────────────────
const STORES = [
  'Beverage Store', 'Dry Store 1', 'Dry Store 2', 'Dry Store 3',
  'Freezer 1', 'Freezer 2', 'General Order',
]

const BEVERAGE_ORDER = [
  '13485','13486','14348','14349','26823','14207','26824','19978','18045','18042',
  '19979','18040','16505','15231','13633','13993','20297','14939','14932','14937',
  '14924','14936','14938','14934','14935','14933','14925','14931','19534','20245',
  '14455','14450','14157','14156','19916','14175','14155','14378','14377','14951',
  '13766','15057','16607','15052','15053','13653','13654','13652','13770','13761',
  '13771','13762','13765','15054','13767','13768','13769','13763','13760','14164',
  '22084','14158','14161','14154','14159','14162','14163','14160','14787','14593',
  '14583','14200','14736','14335','14999','13629','15674','15036',
]

const STATUS_BADGE = { pending: 'yellow', partial: 'orange', received: 'green', cancelled: 'red' }

function codeOf(s) { return String(s || '').replace(/^0+/, '') }

function defaultDeliveryDate() {
  const today = new Date()
  const day = today.getDay()
  let minDiff = 8
  for (const t of [1, 4]) {
    let diff = (t - day + 7) % 7
    if (diff === 0) diff = 7
    if (diff < minDiff) minDiff = diff
  }
  const d = new Date(today)
  d.setDate(d.getDate() + minDiff)
  return d.toISOString().split('T')[0]
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function Orders() {
  const [tab, setTab]                       = useState('order')
  const [selectedStore, setSelectedStore]   = useState('Beverage Store')
  const [rows, setRows]                     = useState([])
  const [deliveryDate, setDeliveryDate]     = useState(defaultDeliveryDate)
  const [search, setSearch]                 = useState('')
  const [loading, setLoading]               = useState(false)
  const [saving, setSaving]                 = useState(false)
  const [exportingPdf, setExportingPdf]     = useState(false)
  const [exportingXlsx, setExportingXlsx]   = useState(false)
  const [resortName, setResortName]         = useState('Outrigger Maafushivaru Resort')
  const [allItems, setAllItems]             = useState([])

  // History
  const [history, setHistory]               = useState([])
  const [histLoad, setHistLoad]             = useState(false)
  const [expanded, setExpanded]             = useState(null)
  const [expandedItems, setExpandedItems]   = useState({})
  const [markingId, setMarkingId]           = useState(null)
  const [exportingHistPdf, setExportingHistPdf]   = useState(null)
  const [exportingHistXlsx, setExportingHistXlsx] = useState(null)
  const [emailingOrder, setEmailingOrder]   = useState(null)

  // Add item to saved order
  const [showAddToOrder, setShowAddToOrder] = useState(null)
  const [savedItemSearch, setSavedItemSearch] = useState('')
  const [savedItem, setSavedItem]           = useState(null)
  const [savedQty, setSavedQty]             = useState('')
  const [addingToOrder, setAddingToOrder]   = useState(false)

  useEffect(() => {
    supabase.from('settings').select('key,value').then(({ data }) => {
      const v = (data || []).find(s => s.key === 'resort_name')?.value
      if (v) setResortName(v)
    })
  }, [])

  // ── Load all items (cached) ───────────────────────────────────────────────
  const loadAllItems = useCallback(async () => {
    if (allItems.length) return allItems
    const { data } = await selectAll(() =>
      supabase.from('items')
        .select('id,name,part_number,unit,current_stock,active,stores(name)')
        .order('name')
    )
    const active = (data || []).filter(i => i && i.active !== false)
    const final  = active.length > 0 ? active : (data || [])
    setAllItems(final)
    return final
  }, [allItems])

  // ── Build ordered row list for a store ───────────────────────────────────
  function makeRow(it, sl) {
    return {
      id: it.id, sl,
      part_number: it.part_number,
      name: it.name,
      store: it.stores?.name || '',
      unit: it.unit || 'EA',
      current_stock: Number(it.current_stock) || 0,
      ordered: 0,
      pack: 1,
      avgWeekly: 0,
      suggested: 0,
    }
  }

  function buildStoreRows(store, items) {
    if (store === 'Beverage Store') {
      const byCode = new Map(items.map(i => [codeOf(i.part_number), i]))
      const seqSet = new Set(BEVERAGE_ORDER)
      const inSeq = BEVERAGE_ORDER
        .map((c, idx) => { const it = byCode.get(c); return it ? makeRow(it, idx + 1) : null })
        .filter(Boolean)
      const extras = items
        .filter(i => (i.stores?.name || '').toLowerCase().includes('beverage') && !seqSet.has(codeOf(i.part_number)))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map((it, i) => makeRow(it, inSeq.length + i + 1))
      return [...inSeq, ...extras]
    }
    if (store === 'General Order') {
      return [...items]
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map((it, i) => makeRow(it, i + 1))
    }
    const kw = store.split(' ')[0].toLowerCase()
    return items
      .filter(i => {
        const sn = (i.stores?.name || '').toLowerCase()
        return sn === store.toLowerCase() || sn.includes(kw)
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map((it, i) => makeRow(it, i + 1))
  }

  // ── Load store ────────────────────────────────────────────────────────────
  const loadStoreItems = useCallback(async (store) => {
    setLoading(true)
    setRows([])
    setSearch('')
    try {
      const items = await loadAllItems()
      setRows(buildStoreRows(store, items))
    } catch (err) {
      toast.error('Failed to load items: ' + err.message)
    }
    setLoading(false)
  }, [loadAllItems]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadStoreItems(selectedStore) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const selectStore = async (store) => {
    setSelectedStore(store)
    await loadStoreItems(store)
  }

  // ── Qty helpers ───────────────────────────────────────────────────────────
  const setQty    = (id, val) => { const n = parseFloat(val); if (!isNaN(n) && n >= 0) setRows(p => p.map(r => r.id === id ? { ...r, ordered: n } : r)) }
  const adjustQty = (id, d)   => setRows(p => p.map(r => r.id === id ? { ...r, ordered: Math.max(0, (r.ordered || 0) + d) } : r))
  const removeRow = (id)       => setRows(p => p.filter(r => r.id !== id))

  const visibleRows = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter(r => r.name.toLowerCase().includes(q) || codeOf(r.part_number).includes(q))
  }, [rows, search])

  const orderRows = rows.filter(r => r.ordered > 0)

  // ── Save order ────────────────────────────────────────────────────────────
  const saveOrder = async () => {
    if (!orderRows.length) { toast.error('Enter a quantity for at least one item'); return }
    setSaving(true)
    try {
      const delivLabel = new Date(deliveryDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
      const { data: order, error } = await supabase.from('order_history').insert({
        delivery_date: deliveryDate,
        delivery_day:  new Date(deliveryDate).toLocaleDateString('en-US', { weekday: 'long' }),
        status:       'pending',
        created_by:   'System',
        notes:        `${selectedStore} · ${delivLabel}`,
        store_name:   selectedStore,
      }).select().single()
      if (error) throw error
      const { error: iErr } = await supabase.from('order_history_items').insert(
        orderRows.map(r => ({
          order_id:    order.id,
          item_id:     r.id,
          part_number: r.part_number,
          item_name:   r.name,
          store_name:  r.store,
          unit:        r.unit,
          ordered_qty: r.ordered,
          received_qty: 0,
        }))
      )
      if (iErr) throw iErr
      toast.success(`${selectedStore} order saved — ${orderRows.length} items`)
      setRows(p => p.map(r => ({ ...r, ordered: 0 })))
    } catch (err) { toast.error(err.message) }
    setSaving(false)
  }

  // ── Export current order PDF ──────────────────────────────────────────────
  const exportPDF = async () => {
    if (!orderRows.length) { toast.error('No items to export'); return }
    setExportingPdf(true)
    try {
      const { default: jsPDF }     = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      const cyan = [0, 174, 239]
      const delivLabel = new Date(deliveryDate).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      doc.setFillColor(...cyan); doc.rect(0, 0, 210, 28, 'F')
      doc.setTextColor(255, 255, 255); doc.setFontSize(18); doc.setFont('helvetica', 'bold')
      doc.text(resortName, 14, 12)
      doc.setFontSize(11); doc.setFont('helvetica', 'normal')
      doc.text(`${selectedStore} — ${delivLabel}`, 14, 21)
      autoTable(doc, {
        startY: 36,
        head: [['SL', 'Part #', 'Item Name', 'Unit', 'In Stock', 'Order Qty']],
        body: orderRows.map(r => [r.sl, codeOf(r.part_number), r.name, r.unit, r.current_stock, r.ordered]),
        headStyles: { fillColor: cyan, fontSize: 9, textColor: 255 },
        styles: { fontSize: 9 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: { 0: { cellWidth: 12 }, 1: { cellWidth: 22, font: 'courier' }, 5: { halign: 'center', fontStyle: 'bold' } },
      })
      const total = orderRows.reduce((s, r) => s + Number(r.ordered), 0)
      const y = doc.lastAutoTable.finalY + 6
      doc.setFontSize(9); doc.setTextColor(100)
      doc.text(`Total: ${orderRows.length} items · ${total} units`, 14, y)
      doc.save(`${selectedStore.replace(/\s+/g, '_')}_${deliveryDate}.pdf`)
      toast.success('PDF exported')
    } catch (err) { toast.error('Export failed: ' + err.message) }
    setExportingPdf(false)
  }

  // ── Export current order Excel ────────────────────────────────────────────
  const exportExcel = async () => {
    if (!orderRows.length) { toast.error('No items to export'); return }
    setExportingXlsx(true)
    try {
      const delivLabel = new Date(deliveryDate).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      await exportOrderExcel(
        { [selectedStore]: orderRows },
        {
          resortName,
          deliveryLabel: `${selectedStore} · ${delivLabel}`,
          filename: `${selectedStore.replace(/\s+/g, '_')}_${deliveryDate}.xlsx`,
        }
      )
      toast.success('Excel exported')
    } catch (err) { toast.error('Export failed: ' + err.message) }
    setExportingXlsx(false)
  }

  // ── History ───────────────────────────────────────────────────────────────
  const loadHistory = async () => {
    setHistLoad(true)
    const { data } = await supabase.from('order_history')
      .select('*')
      .order('delivery_date', { ascending: false })
      .order('created_at',    { ascending: false })
      .limit(100)
    setHistory(data || [])
    setHistLoad(false)
  }

  const loadExpandedItems = async (id) => {
    if (expandedItems[id]) { setExpanded(p => p === id ? null : id); return }
    const { data } = await supabase.from('order_history_items').select('*').eq('order_id', id)
    setExpandedItems(p => ({ ...p, [id]: data || [] }))
    setExpanded(id)
  }

  const markReceived = async (orderId) => {
    const oItems = expandedItems[orderId] || []
    if (!confirm('Mark all items as fully received? Stock will be updated.')) return
    setMarkingId(orderId)
    for (const oi of oItems) {
      if (!oi.item_id || !oi.ordered_qty) continue
      await supabase.rpc('upsert_item_batch', {
        p_batch_id: null, p_item_id: oi.item_id, p_expiry_date: null,
        p_quantity: Number(oi.ordered_qty), p_note: 'Order received',
      }).catch(() => {})
      await supabase.from('order_history_items').update({ received_qty: oi.ordered_qty }).eq('id', oi.id)
    }
    await supabase.from('order_history').update({ status: 'received' }).eq('id', orderId)
    setHistory(p => p.map(o => o.id === orderId ? { ...o, status: 'received' } : o))
    const updated = (expandedItems[orderId] || []).map(i => ({ ...i, received_qty: i.ordered_qty }))
    setExpandedItems(p => ({ ...p, [orderId]: updated }))
    toast.success('Order received — stock updated!')
    setMarkingId(null)
  }

  const markPartialReceived = async (orderId, itemId, receivedQty) => {
    const prevItem = (expandedItems[orderId] || []).find(i => i.id === itemId)
    const delta    = Number(receivedQty) - Number(prevItem?.received_qty || 0)
    if (prevItem?.item_id && delta > 0) {
      await supabase.rpc('upsert_item_batch', {
        p_batch_id: null, p_item_id: prevItem.item_id, p_expiry_date: null,
        p_quantity: delta, p_note: 'Order received (partial)',
      }).catch(() => {})
    }
    await supabase.from('order_history_items').update({ received_qty: receivedQty }).eq('id', itemId)
    const updated = (expandedItems[orderId] || []).map(i => i.id === itemId ? { ...i, received_qty: receivedQty } : i)
    setExpandedItems(p => ({ ...p, [orderId]: updated }))
    const allRec  = updated.every(i => Number(i.received_qty) >= Number(i.ordered_qty))
    const someRec = updated.some(i => Number(i.received_qty) > 0)
    const status  = allRec ? 'received' : someRec ? 'partial' : 'pending'
    await supabase.from('order_history').update({ status }).eq('id', orderId)
    setHistory(p => p.map(o => o.id === orderId ? { ...o, status } : o))
  }

  // ── Export history order PDF ──────────────────────────────────────────────
  const exportHistoryPDF = async (order) => {
    const oItems = expandedItems[order.id]
    if (!oItems?.length) { toast.error('Expand the order first to load items'); return }
    setExportingHistPdf(order.id)
    try {
      const { default: jsPDF }     = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc       = new jsPDF({ unit: 'mm', format: 'a4' })
      const cyan      = [0, 174, 239]
      const storeName = order.store_name || (order.notes || '').split(' · ')[0] || 'Order'
      const delivLabel = order.delivery_date
        ? new Date(order.delivery_date).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        : ''
      doc.setFillColor(...cyan); doc.rect(0, 0, 210, 28, 'F')
      doc.setTextColor(255, 255, 255); doc.setFontSize(18); doc.setFont('helvetica', 'bold')
      doc.text(resortName, 14, 12)
      doc.setFontSize(11); doc.setFont('helvetica', 'normal')
      doc.text(`${storeName} — ${delivLabel}`, 14, 21)
      autoTable(doc, {
        startY: 36,
        head: [['SL', 'Part #', 'Item Name', 'Unit', 'Ordered', 'Received', 'Status']],
        body: oItems.map((oi, idx) => {
          const sf  = Number(oi.ordered_qty) - Number(oi.received_qty)
          const st  = sf <= 0 ? 'Received' : Number(oi.received_qty) > 0 ? `Partial (${sf} short)` : 'Pending'
          return [idx + 1, codeOf(oi.part_number), oi.item_name, oi.unit, oi.ordered_qty, oi.received_qty, st]
        }),
        headStyles: { fillColor: cyan, fontSize: 9, textColor: 255 },
        styles: { fontSize: 9 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: { 0: { cellWidth: 12 }, 1: { cellWidth: 22, font: 'courier' }, 4: { halign: 'center', fontStyle: 'bold' }, 5: { halign: 'center' } },
      })
      const total = oItems.reduce((s, i) => s + Number(i.ordered_qty), 0)
      const y = doc.lastAutoTable.finalY + 6
      doc.setFontSize(9); doc.setTextColor(100)
      doc.text(`Total: ${oItems.length} items · ${total} units · Status: ${order.status}`, 14, y)
      doc.save(`${storeName.replace(/\s+/g, '_')}_${order.delivery_date || 'order'}.pdf`)
      toast.success('PDF exported')
    } catch (err) { toast.error('Export failed: ' + err.message) }
    setExportingHistPdf(null)
  }

  // ── Export history order Excel ────────────────────────────────────────────
  const exportHistoryExcel = async (order) => {
    const oItems = expandedItems[order.id]
    if (!oItems?.length) { toast.error('Expand the order first to load items'); return }
    setExportingHistXlsx(order.id)
    try {
      const storeName  = order.store_name || (order.notes || '').split(' · ')[0] || 'Order'
      const delivLabel = order.delivery_date
        ? new Date(order.delivery_date).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        : ''
      const mappedRows = oItems.map((oi, idx) => ({
        sl: idx + 1, part_number: oi.part_number, name: oi.item_name,
        unit: oi.unit, store: oi.store_name, current_stock: 0,
        pack: 1, avgWeekly: 0, suggested: 0,
        ordered: oi.ordered_qty, received: oi.received_qty,
      }))
      await exportOrderExcel(
        { [storeName]: mappedRows },
        {
          resortName,
          deliveryLabel: `${storeName} · ${delivLabel}`,
          filename: `${storeName.replace(/\s+/g, '_')}_${order.delivery_date || 'order'}.xlsx`,
        }
      )
      toast.success('Excel exported')
    } catch (err) { toast.error('Export failed: ' + err.message) }
    setExportingHistXlsx(null)
  }

  // ── Email history order ───────────────────────────────────────────────────
  const emailOrder = async (order) => {
    const oItems = expandedItems[order.id]
    if (!oItems?.length) { toast.error('Expand the order first to load items'); return }
    setEmailingOrder(order.id)
    try {
      const { data: settings } = await supabase.from('settings').select('key,value')
      const s   = (settings || []).reduce((a, r) => ({ ...a, [r.key]: r.value }), {})
      const key = s.brevo_api_key
      const to  = s.email_recipient || s.recipient_email
      if (!key || !to) {
        toast.error('Configure Brevo API key and recipient email in Settings first')
        setEmailingOrder(null); return
      }
      const storeName  = order.store_name || (order.notes || '').split(' · ')[0] || 'Order'
      const delivLabel = order.delivery_date
        ? new Date(order.delivery_date).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        : ''
      const rows = oItems.map((oi, idx) =>
        `<tr style="background:${idx % 2 ? '#f8fafc' : '#ffffff'}">
           <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;color:#64748b">${idx + 1}</td>
           <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;font-family:monospace;font-size:12px;color:#0ea5e9">${codeOf(oi.part_number)}</td>
           <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;color:#1e293b">${oi.item_name}</td>
           <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:12px;color:#64748b">${oi.unit}</td>
           <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;color:#0d9488">${oi.ordered_qty}</td>
         </tr>`
      ).join('')
      const html = `<div style="font-family:sans-serif;max-width:720px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
        <div style="background:#00AEEF;padding:20px 24px">
          <h2 style="color:#fff;margin:0;font-size:20px">${resortName}</h2>
          <p style="color:#e0f7ff;margin:6px 0 0;font-size:14px">${storeName} — ${delivLabel}</p>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="background:#f1f5f9">
              <th style="padding:9px 12px;text-align:left;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em">SL</th>
              <th style="padding:9px 12px;text-align:left;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Part #</th>
              <th style="padding:9px 12px;text-align:left;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Item Name</th>
              <th style="padding:9px 12px;text-align:center;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Unit</th>
              <th style="padding:9px 12px;text-align:center;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Order Qty</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="padding:14px 16px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:13px;color:#64748b">
          <strong>${oItems.length}</strong> items &nbsp;·&nbsp; <strong>${oItems.reduce((s, i) => s + Number(i.ordered_qty), 0)}</strong> total units
        </div>
      </div>`
      const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: { email: s.email_sender || s.sender_email || 'orders@maafushivaru.com', name: resortName },
          to: [{ email: to }],
          subject: `${storeName} Order — ${delivLabel}`,
          htmlContent: html,
        }),
      })
      if (!resp.ok) throw new Error(`Brevo error ${resp.status}`)
      toast.success(`Order emailed to ${to}`)
    } catch (err) { toast.error('Email failed: ' + err.message) }
    setEmailingOrder(null)
  }

  // ── Add item to saved order ───────────────────────────────────────────────
  const openAddToSavedOrder = async (orderId) => {
    if (!allItems.length) await loadAllItems()
    setSavedItem(null); setSavedItemSearch(''); setSavedQty('')
    setShowAddToOrder(orderId)
  }

  const confirmAddToSavedOrder = async () => {
    if (!savedItem) { toast.error('Select an item'); return }
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
      received_qty: 0,
    })
    if (error) { toast.error(error.message); setAddingToOrder(false); return }
    const { data } = await supabase.from('order_history_items').select('*').eq('order_id', showAddToOrder)
    setExpandedItems(p => ({ ...p, [showAddToOrder]: data || [] }))
    toast.success(`${savedItem.name} added to order`)
    setShowAddToOrder(null); setAddingToOrder(false)
  }

  const filteredSavedItems = allItems.filter(i =>
    !savedItemSearch ||
    i.name.toLowerCase().includes(savedItemSearch.toLowerCase()) ||
    (i.part_number || '').toLowerCase().includes(savedItemSearch.toLowerCase())
  ).slice(0, 8)

  // ── History date grouping ─────────────────────────────────────────────────
  const dateGroups = useMemo(() => {
    const groups = {}
    history.forEach(o => {
      const d = o.delivery_date || 'Unknown'
      if (!groups[d]) groups[d] = []
      groups[d].push(o)
    })
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a))
  }, [history])

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Order Sheet</h1>
          {tab === 'order' && (
            <p className="page-sub">
              {selectedStore} &nbsp;·&nbsp;
              {new Date(deliveryDate).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {tab === 'order' && orderRows.length > 0 && (
            <>
              <Button variant="secondary" onClick={exportExcel} loading={exportingXlsx}><FileSpreadsheet className="w-4 h-4" /> Excel</Button>
              <Button variant="secondary" onClick={exportPDF}   loading={exportingPdf}><FileText className="w-4 h-4" /> PDF</Button>
              <Button onClick={saveOrder} loading={saving}><Save className="w-4 h-4" /> Save Order</Button>
            </>
          )}
          {tab === 'history' && <Button onClick={() => setTab('order')}>← New Order</Button>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-700">
        {[{ key: 'order', label: 'Create Order' }, { key: 'history', label: 'Order History' }].map(({ key, label }) => (
          <button key={key}
            onClick={() => { setTab(key); if (key === 'history') loadHistory() }}
            className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${tab === key ? 'border-[#00AEEF] text-[#00AEEF]' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ══ Create Order tab ══════════════════════════════════════════════════ */}
      {tab === 'order' && (
        <>
          {/* Controls card */}
          <div className="card-sm space-y-4">
            {/* Store selector */}
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-2.5">Select Store</p>
              <div className="flex gap-2 flex-wrap">
                {STORES.map(s => (
                  <button key={s} onClick={() => selectStore(s)}
                    className={`px-4 py-2 rounded-full text-sm font-semibold border transition-all ${
                      selectedStore === s
                        ? 'bg-teal-600 border-teal-600 text-white shadow-lg shadow-teal-900/30'
                        : 'bg-slate-800 border-slate-600 text-slate-300 hover:border-teal-600 hover:text-teal-300'
                    }`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            {/* Delivery date */}
            <div className="flex items-center gap-3 flex-wrap border-t border-slate-700/50 pt-3">
              <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="text-xs text-slate-400 uppercase tracking-wide">Delivery Date</span>
              <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)}
                className="input text-sm py-1.5 w-auto" />
              <span className="text-xs text-slate-500 hidden sm:inline">
                {new Date(deliveryDate).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
            </div>
          </div>

          {/* Loading spinner */}
          {loading && (
            <div className="flex justify-center py-20">
              <div className="w-12 h-12 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && rows.length === 0 && (
            <div className="card text-center py-20 text-slate-500">
              <ShoppingCart className="w-14 h-14 mx-auto mb-4 opacity-20" />
              <p className="font-medium text-lg">No items found</p>
              <p className="text-sm mt-1">Make sure items are assigned to stores in Inventory.</p>
            </div>
          )}

          {!loading && rows.length > 0 && (
            <>
              {/* Stats + search bar */}
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="card-sm py-2 px-4 text-center min-w-[4rem]">
                    <p className="text-xl font-bold text-[#00AEEF]">{rows.length}</p>
                    <p className="text-slate-400 text-xs mt-0.5">Items</p>
                  </div>
                  <div className="card-sm py-2 px-4 text-center min-w-[4rem]">
                    <p className="text-xl font-bold text-teal-400">{orderRows.length}</p>
                    <p className="text-slate-400 text-xs mt-0.5">To Order</p>
                  </div>
                  <div className="card-sm py-2 px-4 text-center min-w-[4rem]">
                    <p className="text-xl font-bold text-teal-300">{orderRows.reduce((s, r) => s + Number(r.ordered), 0)}</p>
                    <p className="text-slate-400 text-xs mt-0.5">Units</p>
                  </div>
                </div>
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input className="input pl-9 text-sm" placeholder="Search items or part #…"
                    value={search} onChange={e => setSearch(e.target.value)} />
                  {search && (
                    <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Order table */}
              <div className="card overflow-hidden p-0">
                <Table>
                  <Thead>
                    <tr>
                      <Th className="w-10 text-center">#</Th>
                      <Th>Part #</Th>
                      <Th>Item Name</Th>
                      <Th className="text-center">Unit</Th>
                      <Th className="text-center">In Stock</Th>
                      <Th>Order Qty</Th>
                      <Th className="w-8"></Th>
                    </tr>
                  </Thead>
                  <Tbody>
                    {visibleRows.map(row => (
                      <Tr key={row.id}
                        className={row.ordered > 0 ? 'bg-teal-900/10 border-l-2 border-l-teal-600' : ''}>
                        <Td className="text-xs text-slate-500 tabular-nums text-center">{row.sl}</Td>
                        <Td className="font-mono text-xs text-slate-400">{codeOf(row.part_number)}</Td>
                        <Td>
                          <p className={`text-sm font-medium truncate max-w-xs ${row.ordered > 0 ? 'text-teal-200' : 'text-slate-100'}`}>
                            {row.name}
                          </p>
                        </Td>
                        <Td className="text-center">
                          <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-700 text-teal-300 whitespace-nowrap">
                            {row.unit}
                          </span>
                        </Td>
                        <Td className={`text-center font-semibold ${Number(row.current_stock) <= 0 ? 'text-red-400' : 'text-slate-300'}`}>
                          {row.current_stock}
                        </Td>
                        <Td>
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => adjustQty(row.id, -1)}
                              className="w-7 h-7 flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300 transition-colors">
                              <Minus className="w-3 h-3" />
                            </button>
                            <input type="number" min="0" value={row.ordered}
                              onChange={e => setQty(row.id, e.target.value)}
                              className={`w-16 border rounded-lg px-2 py-1.5 text-center text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500 transition-colors ${
                                row.ordered > 0
                                  ? 'bg-teal-900/25 border-teal-600 text-teal-200'
                                  : 'bg-slate-700 border-slate-600 text-slate-100'
                              }`} />
                            <button onClick={() => adjustQty(row.id, 1)}
                              className="w-7 h-7 flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300 transition-colors">
                              <Plus className="w-3 h-3" />
                            </button>
                            <span className="text-xs text-slate-500 w-8 shrink-0 truncate">{row.unit}</span>
                          </div>
                        </Td>
                        <Td>
                          <button onClick={() => removeRow(row.id)}
                            className="p-1 text-slate-600 hover:text-red-400 rounded-lg transition-colors"
                            title="Remove from list">
                            <X className="w-4 h-4" />
                          </button>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </div>

              {/* Sticky save bar — only when items have qty */}
              {orderRows.length > 0 && (
                <div className="flex items-center justify-between gap-4 p-4 card border border-teal-700/30 bg-teal-900/10">
                  <p className="text-sm text-teal-300 font-medium">
                    <strong>{orderRows.length}</strong> items · <strong>{orderRows.reduce((s, r) => s + Number(r.ordered), 0)}</strong> units ready to save
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <Button variant="secondary" onClick={exportExcel} loading={exportingXlsx}><FileSpreadsheet className="w-4 h-4" /> Excel</Button>
                    <Button variant="secondary" onClick={exportPDF}   loading={exportingPdf}><FileText className="w-4 h-4" /> PDF</Button>
                    <Button onClick={saveOrder} loading={saving}><Save className="w-4 h-4" /> Save Order</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ══ History tab ═══════════════════════════════════════════════════════ */}
      {tab === 'history' && (
        <div className="space-y-3">
          {histLoad ? (
            <div className="flex justify-center py-16">
              <div className="w-10 h-10 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <div className="card text-center py-16 text-slate-500">
              <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="font-medium">No saved orders yet</p>
              <p className="text-sm mt-1">Create and save an order to see it here.</p>
            </div>
          ) : dateGroups.map(([date, dateOrders]) => {
            const dateLabel = date !== 'Unknown'
              ? new Date(date).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })
              : 'Unknown Date'
            return (
              <div key={date} className="card border border-slate-700/40">
                {/* Date header */}
                <div className="flex items-center gap-3 pb-3 mb-3 border-b border-slate-700/40">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#00AEEF] shrink-0" />
                  <div className="flex-1">
                    <p className="font-bold text-slate-100 text-base">{dateLabel}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {dateOrders.length} order{dateOrders.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>

                {/* Orders for this date */}
                <div className="space-y-2">
                  {dateOrders.map(order => {
                    const oItems  = expandedItems[order.id] || []
                    const isExp   = expanded === order.id
                    const storeName = order.store_name || (order.notes || '').split(' · ')[0] || `${order.delivery_day || ''} Order`
                    const undelivered = oItems.filter(i => Number(i.received_qty) < Number(i.ordered_qty)).length
                    return (
                      <div key={order.id} className="border border-slate-700/30 rounded-xl overflow-hidden">
                        {/* Order row header */}
                        <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 bg-slate-800/40">
                          <button className="flex items-center gap-3 text-left flex-1 min-w-0"
                            onClick={() => loadExpandedItems(order.id)}>
                            {isExp
                              ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                              : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-semibold text-slate-100 truncate">{storeName}</p>
                                <Badge variant={STATUS_BADGE[order.status] || 'gray'}>{order.status}</Badge>
                                {oItems.length > 0 && <span className="text-xs text-slate-400">{oItems.length} items</span>}
                                {isExp && undelivered > 0 && order.status !== 'received' && (
                                  <span className="text-xs text-orange-400 flex items-center gap-1">
                                    <PackageX className="w-3 h-3" />{undelivered} missing
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500 mt-0.5">
                                Saved {new Date(order.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                              </p>
                            </div>
                          </button>

                          {/* Action buttons */}
                          <div className="flex gap-2 flex-wrap items-center">
                            <button onClick={() => openAddToSavedOrder(order.id)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-400 border border-blue-700/30 bg-blue-900/10 hover:bg-blue-900/30 rounded-lg transition-colors">
                              <PlusCircle className="w-3.5 h-3.5" /> Add Item
                            </button>
                            {isExp && oItems.length > 0 && (
                              <>
                                <button onClick={() => exportHistoryExcel(order)}
                                  disabled={exportingHistXlsx === order.id}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-400 border border-emerald-700/30 bg-emerald-900/10 hover:bg-emerald-900/30 rounded-lg transition-colors disabled:opacity-50">
                                  <FileSpreadsheet className="w-3.5 h-3.5" />
                                  {exportingHistXlsx === order.id ? 'Exporting…' : 'Excel'}
                                </button>
                                <button onClick={() => exportHistoryPDF(order)}
                                  disabled={exportingHistPdf === order.id}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-400 border border-rose-700/30 bg-rose-900/10 hover:bg-rose-900/30 rounded-lg transition-colors disabled:opacity-50">
                                  <FileText className="w-3.5 h-3.5" />
                                  {exportingHistPdf === order.id ? 'Exporting…' : 'PDF'}
                                </button>
                                <button onClick={() => emailOrder(order)}
                                  disabled={emailingOrder === order.id}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-400 border border-purple-700/30 bg-purple-900/10 hover:bg-purple-900/30 rounded-lg transition-colors disabled:opacity-50">
                                  <Mail className="w-3.5 h-3.5" />
                                  {emailingOrder === order.id ? 'Sending…' : 'Email'}
                                </button>
                              </>
                            )}
                            {order.status !== 'received' && order.status !== 'cancelled' && (
                              <Button
                                onClick={() => { loadExpandedItems(order.id); setTimeout(() => markReceived(order.id), 500) }}
                                loading={markingId === order.id} variant="secondary">
                                ✓ Mark Received
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Expanded items table */}
                        {isExp && oItems.length > 0 && (
                          <div className="border-t border-slate-700/40">
                            <Table>
                              <Thead>
                                <tr>
                                  <Th className="w-10 text-center">SL</Th>
                                  <Th>Part #</Th>
                                  <Th>Item</Th>
                                  <Th className="text-center">Unit</Th>
                                  <Th className="text-center">Ordered</Th>
                                  <Th className="text-center">Received</Th>
                                  <Th>Status</Th>
                                </tr>
                              </Thead>
                              <Tbody>
                                {oItems.map((oi, idx) => {
                                  const shortfall  = Number(oi.ordered_qty) - Number(oi.received_qty)
                                  const isReceived = shortfall <= 0
                                  return (
                                    <Tr key={oi.id} className={isReceived ? 'opacity-60' : ''}>
                                      <Td className="text-xs text-slate-500 tabular-nums text-center">{idx + 1}</Td>
                                      <Td className="font-mono text-xs text-slate-300">{codeOf(oi.part_number)}</Td>
                                      <Td className="font-medium text-slate-100 max-w-xs truncate">{oi.item_name}</Td>
                                      <Td className="text-center">
                                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-700 text-teal-300">{oi.unit}</span>
                                      </Td>
                                      <Td className="text-center text-teal-400 font-bold">{oi.ordered_qty}</Td>
                                      <Td className="text-center">
                                        {order.status !== 'received' ? (
                                          <input type="number" min="0" max={oi.ordered_qty}
                                            defaultValue={oi.received_qty}
                                            className="w-20 input text-xs py-1 text-center"
                                            onBlur={e => {
                                              const v = Number(e.target.value)
                                              if (v !== Number(oi.received_qty)) markPartialReceived(order.id, oi.id, v)
                                            }} />
                                        ) : (
                                          <span className="text-green-400 font-bold">{oi.received_qty}</span>
                                        )}
                                      </Td>
                                      <Td>
                                        {isReceived
                                          ? <Badge variant="green">Received</Badge>
                                          : shortfall === Number(oi.ordered_qty)
                                            ? <Badge variant="yellow">Pending</Badge>
                                            : <Badge variant="orange">Partial ({shortfall} short)</Badge>}
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
              </div>
            )
          })}
        </div>
      )}

      {/* ══ Modal: Add item to saved order ═══════════════════════════════════ */}
      {showAddToOrder && (
        <Modal isOpen onClose={() => setShowAddToOrder(null)} title="Add Item to Saved Order" size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowAddToOrder(null)}>Cancel</Button>
              <Button onClick={confirmAddToSavedOrder} loading={addingToOrder}>Add to Order</Button>
            </>
          }>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Item *</label>
              {savedItem ? (
                <div className="input bg-slate-700/50 flex items-center gap-2">
                  <span className="font-mono text-xs text-[#00AEEF]">{savedItem.part_number}</span>
                  <span className="flex-1 text-slate-100">{savedItem.name}</span>
                  <span className="text-slate-400 text-xs">{savedItem.unit}</span>
                  <button onClick={() => { setSavedItem(null); setSavedItemSearch('') }}>
                    <X className="w-4 h-4 text-slate-400" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input className="input pl-9 text-sm" placeholder="Search by name or part #…"
                    value={savedItemSearch} onChange={e => setSavedItemSearch(e.target.value)} autoFocus />
                  {filteredSavedItems.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-600 rounded-xl shadow-xl max-h-52 overflow-y-auto">
                      {filteredSavedItems.map(item => (
                        <button key={item.id}
                          onClick={() => { setSavedItem(item); setSavedItemSearch('') }}
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
            <Input
              label={`Quantity *${savedItem ? ` (${savedItem.unit})` : ''}`}
              type="number" min="1" value={savedQty}
              onChange={e => setSavedQty(e.target.value)} />
            {savedItem && (
              <div className="text-xs text-slate-400 bg-slate-700/30 rounded-lg p-2.5">
                In stock: <strong className="text-slate-200">{savedItem.current_stock} {savedItem.unit}</strong>
                {savedItem.stores?.name && <> &nbsp;·&nbsp; Store: {savedItem.stores.name}</>}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
