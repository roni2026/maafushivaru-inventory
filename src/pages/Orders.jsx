import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { supabase, selectAll } from '../lib/supabase'
import {
  ShoppingCart, Save, Minus, Plus, ChevronDown, ChevronRight,
  Search, X, PlusCircle, FileSpreadsheet, FileText, Mail,
  Calendar, RefreshCw, AlertTriangle, CheckCircle2, Link, Inbox,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import { exportOrderExcel } from '../lib/excelExport'

const STORES = ['Beverage Store','Dry Store 1','Dry Store 2','Dry Store 3','Freezer 1','Freezer 2','General Order']
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
const BEVERAGE_CODES_ALL = [...new Set(BEVERAGE_ORDER.flatMap(c => [c, '0'+c, '00'+c, '000'+c]))]
const ORDER_STATUSES = ['draft','submitted','pending_approval','approved','partially_received','received','exception','cancelled']
const STATUS_BADGE = { draft:'gray', submitted:'blue', pending_approval:'orange', approved:'teal', partially_received:'orange', received:'green', exception:'red', cancelled:'gray' }
const ISSUE_TYPES = ['none','wrong_item','duplicate','short_qty']
const ISSUE_LABELS = { none:'None', wrong_item:'Wrong Item', duplicate:'Duplicate', short_qty:'Short Quantity' }
const SHEET_ID = '1ntDKFbwjKeCRHbnyar76x2YNDPRUp-bQokKhqIe6eg8'

function codeOf(s) { return String(s || '').replace(/^0+/, '') }
function defaultDeliveryDate() {
  const t = new Date(), day = t.getDay(); let min = 8
  for (const d of [1,4]) { let diff=(d-day+7)%7; if(diff===0)diff=7; if(diff<min)min=diff }
  const r = new Date(t); r.setDate(t.getDate()+min); return r.toISOString().split('T')[0]
}
function fmtDate(s) { if (!s) return '—'; return new Date(s).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) }
function fmtDateTime(s) { if (!s) return '—'; return new Date(s).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) }

// Compute avg consumption using received_qty > approved_qty > ordered_qty priority
async function computeAvgData(items, partNums) {
  if (!partNums.length) return { avgMap:{}, prevMap:{} }
  const { data: obs } = await supabase
    .from('order_physical_stock')
    .select('item_id,part_number,physical_qty,week_date,order_id')
    .in('part_number', partNums)
    .order('week_date', { ascending: true })
    .limit(1000)
  if (!obs?.length) return { avgMap:{}, prevMap:{} }
  const orderIds = [...new Set(obs.map(o => o.order_id).filter(Boolean))]
  const qtyMap = new Map()
  if (orderIds.length) {
    const [{ data: oItems }, { data: rcvRecs }] = await Promise.all([
      supabase.from('order_history_items').select('order_id,part_number,ordered_qty,approved_qty').in('order_id', orderIds),
      supabase.from('order_receiving_records').select('order_id,part_number,received_qty').in('order_id', orderIds),
    ])
    ;(oItems||[]).forEach(oi => {
      const k = `${oi.order_id}::${codeOf(oi.part_number)}`
      qtyMap.set(k, Number(oi.approved_qty) || Number(oi.ordered_qty) || 0)
    })
    // Override with actual received quantity (most accurate for consumption)
    ;(rcvRecs||[]).forEach(r => {
      const k = `${r.order_id}::${codeOf(r.part_number)}`
      if (Number(r.received_qty) > 0) qtyMap.set(k, Number(r.received_qty))
    })
  }
  const byItem = new Map()
  obs.forEach(o => { const k = codeOf(o.part_number); if (!byItem.has(k)) byItem.set(k, []); byItem.get(k).push(o) })
  const avgMap = {}, prevMap = {}
  byItem.forEach((periods, partCode) => {
    const consumptions = []
    for (let i = 1; i < periods.length; i++) {
      const prev = periods[i-1], curr = periods[i]
      const qty = qtyMap.get(`${prev.order_id}::${partCode}`) ?? 0
      const c = Number(prev.physical_qty) + qty - Number(curr.physical_qty)
      if (c >= 0) consumptions.push(c)
    }
    const item = items.find(i => codeOf(i.part_number) === partCode)
    if (!item) return
    if (consumptions.length > 0) {
      const avg = consumptions.reduce((s,c) => s+c, 0) / consumptions.length
      avgMap[item.id] = Math.round(avg * 10) / 10
      avgMap[`pn::${partCode}`] = avgMap[item.id]
    }
    // Store last period data for real-time physstock calculation
    if (periods.length > 0) {
      const last = periods[periods.length-1]
      prevMap[item.id] = {
        prev_physical: Number(last.physical_qty),
        prev_qty: qtyMap.get(`${last.order_id}::${partCode}`) ?? 0,
        hist_avg: consumptions.length > 0 ? consumptions.reduce((s,c)=>s+c,0)/consumptions.length : null,
        hist_n: consumptions.length,
      }
    }
  })
  return { avgMap, prevMap }
}

function makeRow(it, sl, avgMap) {
  const avg = avgMap[it.id] ?? avgMap[`pn::${codeOf(it.part_number)}`] ?? null
  return { id:it.id, sl, part_number:it.part_number, name:it.name, store:it.stores?.name||'', unit:it.unit||'EA', physStock:'', ordered:0, approvedQty:0, itemStatus:'draft', avgConsumption:avg }
}

function buildStoreRows(store, items, avgMap) {
  if (store === 'Beverage Store') {
    const byCode = new Map(items.map(i => [codeOf(i.part_number), i]))
    const seqSet = new Set(BEVERAGE_ORDER)
    const inSeq  = BEVERAGE_ORDER.map((c,i) => { const it=byCode.get(c); return it?makeRow(it,i+1,avgMap):null }).filter(Boolean)
    const extras = items.filter(i => !seqSet.has(codeOf(i.part_number)) && (i.stores?.name||'').toLowerCase().includes('beverage'))
      .sort((a,b) => (a.name||'').localeCompare(b.name||'')).map((it,i) => makeRow(it,inSeq.length+i+1,avgMap))
    return [...inSeq, ...extras]
  }
  return [...items].sort((a,b) => (a.name||'').localeCompare(b.name||'')).map((it,i) => makeRow(it,i+1,avgMap))
}

export default function Orders() {
  const [tab, setTab] = useState('order')
  const [selectedStore, setSelectedStore] = useState('Beverage Store')
  const [rows, setRows]         = useState([])
  const [deliveryDate, setDeliveryDate] = useState(defaultDeliveryDate)
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const [exportingPdf, setExportingPdf]   = useState(false)
  const [exportingXlsx, setExportingXlsx] = useState(false)
  const [resortName, setResortName] = useState('Outrigger Maafushivaru Resort')
  const [prevDataMap, setPrevDataMap] = useState({})
  const storeItemsCache = useRef({})

  // + Add Item panel
  const [showAddItem, setShowAddItem] = useState(false)
  const [addSearch, setAddSearch]     = useState('')
  const [addResults, setAddResults]   = useState([])
  const [addLoading, setAddLoading]   = useState(false)

  // Order History
  const [history, setHistory]         = useState([])
  const [histLoad, setHistLoad]       = useState(false)
  const [histSearch, setHistSearch]   = useState('')
  const [histStatus, setHistStatus]   = useState('')
  const [histFrom, setHistFrom]       = useState('')
  const [histTo, setHistTo]           = useState('')
  const [expanded, setExpanded]       = useState(null)
  const [expandedItems, setExpandedItems] = useState({})
  const [exportingHistPdf, setExportingHistPdf]   = useState(null)
  const [exportingHistXlsx, setExportingHistXlsx] = useState(null)
  const [emailingOrder, setEmailingOrder] = useState(null)
  const [showAddToOrder, setShowAddToOrder] = useState(null)
  const [savedItemSearch, setSavedItemSearch] = useState('')
  const [savedItem, setSavedItem]   = useState(null)
  const [savedQty, setSavedQty]     = useState('')
  const [addingToOrder, setAddingToOrder] = useState(false)

  // Receiving
  const [rcvOrders, setRcvOrders]   = useState([])
  const [rcvLoad, setRcvLoad]       = useState(false)
  const [rcvExpanded, setRcvExpanded] = useState(null)
  const [rcvItems, setRcvItems]     = useState({})
  const [rcvInput, setRcvInput]     = useState({})
  const [rcvSaving, setRcvSaving]   = useState(null)

  // Receiving History
  const [rcvHistory, setRcvHistory]     = useState([])
  const [rcvHistLoad, setRcvHistLoad]   = useState(false)
  const [rcvHistSearch, setRcvHistSearch] = useState('')
  const [rcvHistFrom, setRcvHistFrom]   = useState('')
  const [rcvHistStatus, setRcvHistStatus] = useState('')

  // Requisitions
  const [requisitions, setRequisitions] = useState([])
  const [reqLoad, setReqLoad]   = useState(false)
  const [syncing, setSyncing]   = useState(false)
  const [lastSync, setLastSync] = useState(null)
  const [syncResult, setSyncResult] = useState(null)

  useEffect(() => {
    supabase.from('settings').select('key,value').then(({ data }) => {
      const v = (data||[]).find(s => s.key==='resort_name')?.value
      if (v) setResortName(v)
    })
  }, [])

  // Load only relevant items per store (fast, not all inventory)
  const loadItemsForStore = useCallback(async (store) => {
    if (storeItemsCache.current[store]) return storeItemsCache.current[store]
    let items = []
    if (store === 'Beverage Store') {
      const [{ data: d1 }, { data: d2 }] = await Promise.all([
        supabase.from('items').select('id,name,part_number,unit,current_stock,active,stores(name)').in('part_number', BEVERAGE_CODES_ALL),
        supabase.from('items').select('id,name,part_number,unit,current_stock,active,stores(name)').ilike('stores.name', '%beverage%'),
      ])
      const all = [...(d1||[]), ...(d2||[])]
      const seen = new Set()
      items = all.filter(i => i && i.active !== false && !seen.has(i.id) && seen.add(i.id))
    } else if (store === 'General Order') {
      const { data } = await selectAll(() =>
        supabase.from('items').select('id,name,part_number,unit,current_stock,active,stores(name)').order('name')
      )
      items = (data||[]).filter(i => i?.active !== false)
    } else {
      const { data: d1 } = await supabase.from('items')
        .select('id,name,part_number,unit,current_stock,active,stores(name)')
        .eq('stores.name', store).order('name')
      items = (d1||[]).filter(i => i?.active !== false)
      if (!items.length) {
        const kw = store.split(' ')[0]
        const { data: d2 } = await supabase.from('items')
          .select('id,name,part_number,unit,current_stock,active,stores(name)')
          .ilike('stores.name', `%${kw}%`).order('name')
        items = (d2||[]).filter(i => i?.active !== false)
      }
    }
    storeItemsCache.current[store] = items
    return items
  }, [])

  const loadStore = useCallback(async (store) => {
    setLoading(true); setRows([]); setSearch('')
    try {
      const items = await loadItemsForStore(store)
      const partNums = items.map(i => codeOf(i.part_number)).filter(Boolean)
      const { avgMap, prevMap } = await computeAvgData(items, partNums)
      setPrevDataMap(prevMap)
      setRows(buildStoreRows(store, items, avgMap))
    } catch (err) { toast.error('Load failed: '+err.message) }
    setLoading(false)
  }, [loadItemsForStore])

  useEffect(() => { loadStore('Beverage Store') }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const selectStore = async (store) => { setSelectedStore(store); await loadStore(store) }

  // Real-time avg consumption recalculation as user types physical stock
  const setPhysStockRT = useCallback((id, val) => {
    if (val === '') { setRows(p => p.map(r => r.id===id ? {...r, physStock:''} : r)); return }
    const n = parseFloat(val)
    if (isNaN(n) || n < 0) return
    setRows(p => p.map(r => {
      if (r.id !== id) return r
      const prev = prevDataMap[id]
      if (!prev || prev.prev_physical == null) return {...r, physStock:n}
      // consumption = prev_physical + qty_received_or_approved - current_physical
      const thisPeriod = prev.prev_physical + (prev.prev_qty || 0) - n
      if (thisPeriod < 0) return {...r, physStock:n}
      const hn = prev.hist_n || 0, ha = prev.hist_avg
      const newAvg = (hn === 0 || ha == null)
        ? Math.round(thisPeriod * 10) / 10
        : Math.round(((ha * hn + thisPeriod) / (hn + 1)) * 10) / 10
      return {...r, physStock:n, avgConsumption:newAvg}
    }))
  }, [prevDataMap])

  const adjustQty = (id, d) => setRows(p => p.map(r => r.id===id ? {...r, ordered:Math.max(0,(r.ordered||0)+d)} : r))
  const setQty    = (id, v) => { const n=parseFloat(v); setRows(p => p.map(r => r.id===id ? {...r, ordered:(!isNaN(n)&&n>=0)?n:0} : r)) }
  const removeRow = (id) => setRows(p => p.filter(r => r.id !== id))

  const visibleRows = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter(r => r.name.toLowerCase().includes(q) || codeOf(r.part_number).includes(q))
  }, [rows, search])

  const orderRows = rows.filter(r => r.ordered > 0)

  // + Add Item from full inventory search
  const searchAllItems = useCallback(async (query) => {
    if (!query.trim()) { setAddResults([]); return }
    setAddLoading(true)
    const { data } = await supabase.from('items')
      .select('id,name,part_number,unit,current_stock,active,stores(name)')
      .or(`name.ilike.%${query}%,part_number.ilike.%${query}%`)
      .neq('active', false).order('name').limit(20)
    setAddResults(data || []); setAddLoading(false)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => searchAllItems(addSearch), 300)
    return () => clearTimeout(t)
  }, [addSearch, searchAllItems])

  const addItemToOrder = (item) => {
    if (rows.find(r => r.id === item.id)) { toast.error('Already in order'); return }
    const prev = prevDataMap[item.id]
    setRows(p => [...p, {
      id:item.id, sl:p.length+1, part_number:item.part_number, name:item.name,
      store:item.stores?.name||'', unit:item.unit||'EA',
      physStock:'', ordered:0, approvedQty:0, itemStatus:'draft',
      avgConsumption: prev?.hist_avg!=null ? Math.round(prev.hist_avg*10)/10 : null,
    }])
    setShowAddItem(false); setAddSearch(''); setAddResults([])
    toast.success(`${item.name} added`)
  }

  const saveOrder = async () => {
    if (!orderRows.length) { toast.error('Enter quantity for at least one item'); return }
    setSaving(true)
    try {
      const delivLabel = new Date(deliveryDate).toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})
      const { data: order, error } = await supabase.from('order_history').insert({
        delivery_date:deliveryDate, delivery_day:new Date(deliveryDate).toLocaleDateString('en-US',{weekday:'long'}),
        status:'submitted', created_by:'System', notes:`${selectedStore} · ${delivLabel}`, store_name:selectedStore,
      }).select().single()
      if (error) throw error
      const { error: iErr } = await supabase.from('order_history_items').insert(
        orderRows.map(r => ({ order_id:order.id, item_id:r.id, part_number:r.part_number, item_name:r.name, store_name:r.store||selectedStore, unit:r.unit, ordered_qty:r.ordered, received_qty:0, approved_qty:r.approvedQty||0, item_status:'submitted' }))
      )
      if (iErr) throw iErr
      const physRows = orderRows.filter(r => r.physStock !== '' && r.physStock != null)
      if (physRows.length) {
        await supabase.from('order_physical_stock').insert(
          physRows.map(r => ({ item_id:r.id, part_number:r.part_number, item_name:r.name, store_name:selectedStore, physical_qty:Number(r.physStock)||0, week_date:deliveryDate, order_id:order.id, recorded_by:'System' }))
        )
        delete storeItemsCache.current[selectedStore] // invalidate to refresh avg next load
      }
      toast.success(`Order saved — ${orderRows.length} items`)
      setRows(p => p.map(r => ({...r, ordered:0, physStock:''})))
    } catch (err) { toast.error(err.message) }
    setSaving(false)
  }

  const exportPDF = async () => {
    if (!orderRows.length) { toast.error('No items to export'); return }
    setExportingPdf(true)
    try {
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF({unit:'mm',format:'a4'}), cyan=[0,174,239]
      const lbl = new Date(deliveryDate).toLocaleDateString('en-US',{weekday:'long',day:'numeric',month:'long',year:'numeric'})
      doc.setFillColor(...cyan); doc.rect(0,0,210,28,'F')
      doc.setTextColor(255,255,255); doc.setFontSize(16); doc.setFont('helvetica','bold'); doc.text(resortName,14,11)
      doc.setFontSize(10); doc.setFont('helvetica','normal'); doc.text(`${selectedStore} — ${lbl}`,14,20)
      autoTable(doc,{startY:36,head:[['#','Part #','Item Name','UOM','Avg/Wk','Physical Stock','Order Qty']],
        body:orderRows.map(r=>[r.sl,codeOf(r.part_number),r.name,r.unit,r.avgConsumption!=null?r.avgConsumption:'—',r.physStock!==''?r.physStock:'—',r.ordered]),
        headStyles:{fillColor:cyan,fontSize:8,textColor:255},styles:{fontSize:8},alternateRowStyles:{fillColor:[248,250,252]},
        columnStyles:{0:{cellWidth:9},1:{cellWidth:20,font:'courier'},6:{halign:'center',fontStyle:'bold'}}})
      doc.text(`${orderRows.length} items · ${orderRows.reduce((s,r)=>s+Number(r.ordered),0)} units`,14,doc.lastAutoTable.finalY+5)
      doc.save(`${selectedStore.replace(/\s+/g,'_')}_${deliveryDate}.pdf`)
      toast.success('PDF exported')
    } catch (err) { toast.error('Export failed: '+err.message) }
    setExportingPdf(false)
  }

  const exportExcel = async () => {
    if (!orderRows.length) { toast.error('No items to export'); return }
    setExportingXlsx(true)
    try {
      const lbl = new Date(deliveryDate).toLocaleDateString('en-US',{weekday:'long',day:'numeric',month:'long',year:'numeric'})
      await exportOrderExcel({[selectedStore]:orderRows},{resortName,deliveryLabel:`${selectedStore} · ${lbl}`,filename:`${selectedStore.replace(/\s+/g,'_')}_${deliveryDate}.xlsx`})
      toast.success('Excel exported')
    } catch (err) { toast.error('Export failed: '+err.message) }
    setExportingXlsx(false)
  }

  // Order History
  const loadHistory = useCallback(async () => {
    setHistLoad(true)
    let q = supabase.from('order_history').select('*').order('delivery_date',{ascending:false}).order('created_at',{ascending:false}).limit(200)
    if (histStatus) q = q.eq('status', histStatus)
    if (histFrom)   q = q.gte('delivery_date', histFrom)
    if (histTo)     q = q.lte('delivery_date', histTo)
    const { data } = await q; setHistory(data||[]); setHistLoad(false)
  }, [histStatus, histFrom, histTo])
  useEffect(() => { if (tab==='history') loadHistory() }, [tab, histStatus, histFrom, histTo]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadExpandedItems = async (id) => {
    if (expanded === id) { setExpanded(null); return }
    if (!expandedItems[id]) { const{data}=await supabase.from('order_history_items').select('*').eq('order_id',id); setExpandedItems(p=>({...p,[id]:data||[]})) }
    setExpanded(id)
  }

  const histFiltered = useMemo(() => {
    if (!histSearch.trim()) return history
    const q = histSearch.toLowerCase()
    return history.filter(o => (o.store_name||'').toLowerCase().includes(q)||(o.notes||'').toLowerCase().includes(q)||(o.delivery_date||'').includes(q))
  }, [history, histSearch])

  const histDateGroups = useMemo(() => {
    const g = {}; histFiltered.forEach(o => { const d=o.delivery_date||'Unknown'; (g[d]=g[d]||[]).push(o) })
    return Object.entries(g).sort(([a],[b]) => b.localeCompare(a))
  }, [histFiltered])

  const exportHistoryPDF = async (order) => {
    const oItems = expandedItems[order.id]; if (!oItems?.length){toast.error('Expand first');return}
    setExportingHistPdf(order.id)
    try {
      const{default:jsPDF}=await import('jspdf'),{default:autoTable}=await import('jspdf-autotable')
      const doc=new jsPDF({unit:'mm',format:'a4'}),cyan=[0,174,239]
      const sn=order.store_name||(order.notes||'').split(' · ')[0]||'Order'
      doc.setFillColor(...cyan);doc.rect(0,0,210,28,'F');doc.setTextColor(255,255,255);doc.setFontSize(16);doc.setFont('helvetica','bold');doc.text(resortName,14,11)
      doc.setFontSize(10);doc.setFont('helvetica','normal');doc.text(`${sn} — ${fmtDate(order.delivery_date)}`,14,20)
      autoTable(doc,{startY:36,head:[['SL','Part #','Item Name','UOM','Ordered','Approved','Received','Status']],
        body:oItems.map((oi,i)=>{const sf=Number(oi.ordered_qty)-Number(oi.received_qty);return[i+1,codeOf(oi.part_number),oi.item_name,oi.unit,oi.ordered_qty,oi.approved_qty||'—',oi.received_qty,sf<=0?'Received':Number(oi.received_qty)>0?'Partial':'Pending']}),
        headStyles:{fillColor:cyan,fontSize:8,textColor:255},styles:{fontSize:8},alternateRowStyles:{fillColor:[248,250,252]}})
      doc.save(`${sn.replace(/\s+/g,'_')}_${order.delivery_date||'order'}.pdf`); toast.success('PDF exported')
    } catch(err){toast.error('Export failed: '+err.message)}
    setExportingHistPdf(null)
  }

  const exportHistoryExcel = async (order) => {
    const oItems=expandedItems[order.id]; if(!oItems?.length){toast.error('Expand first');return}
    setExportingHistXlsx(order.id)
    try{
      const sn=order.store_name||(order.notes||'').split(' · ')[0]||'Order'
      await exportOrderExcel({[sn]:oItems.map((oi,i)=>({sl:i+1,part_number:oi.part_number,name:oi.item_name,unit:oi.unit,store:oi.store_name||sn,current_stock:0,pack:1,avgWeekly:0,suggested:0,ordered:oi.ordered_qty,received:oi.received_qty}))},
        {resortName,deliveryLabel:`${sn} · ${fmtDate(order.delivery_date)}`,filename:`${sn.replace(/\s+/g,'_')}_${order.delivery_date||'order'}.xlsx`})
      toast.success('Excel exported')
    }catch(err){toast.error('Export failed: '+err.message)}
    setExportingHistXlsx(null)
  }

  const emailOrder = async (order) => {
    const oItems=expandedItems[order.id]; if(!oItems?.length){toast.error('Expand first');return}
    setEmailingOrder(order.id)
    try{
      const{data:settings}=await supabase.from('settings').select('key,value')
      const s=(settings||[]).reduce((a,r)=>({...a,[r.key]:r.value}),{})
      if(!s.brevo_api_key||!s.email_recipient){toast.error('Set Brevo key + recipient in Settings');setEmailingOrder(null);return}
      const sn=order.store_name||(order.notes||'').split(' · ')[0]||'Order', lbl=fmtDate(order.delivery_date)
      const trs=oItems.map((oi,i)=>`<tr style="background:${i%2?'#f8fafc':'#fff'}"><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#64748b">${i+1}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-family:monospace">${codeOf(oi.part_number)}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${oi.item_name}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:center">${oi.unit}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;color:#0d9488">${oi.ordered_qty}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:center">${oi.approved_qty||'—'}</td></tr>`).join('')
      const html=`<div style="font-family:sans-serif;max-width:720px;margin:0 auto;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden"><div style="background:#00AEEF;padding:18px 20px"><h2 style="color:#fff;margin:0">${resortName}</h2><p style="color:#e0f7ff;margin:4px 0 0;font-size:13px">${sn} — ${lbl}</p></div><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f1f5f9"><th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b">SL</th><th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b">Part #</th><th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b">Item</th><th style="padding:8px 10px;text-align:center;font-size:11px;color:#64748b">Unit</th><th style="padding:8px 10px;text-align:center;font-size:11px;color:#64748b">Ordered</th><th style="padding:8px 10px;text-align:center;font-size:11px;color:#64748b">Approved</th></tr></thead><tbody>${trs}</tbody></table><div style="padding:10px 12px;background:#f8fafc;font-size:12px;color:#64748b"><strong>${oItems.length}</strong> items</div></div>`
      const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':s.brevo_api_key,'Content-Type':'application/json'},body:JSON.stringify({sender:{email:s.email_sender||'orders@maafushivaru.com',name:resortName},to:[{email:s.email_recipient}],subject:`${sn} Order — ${lbl}`,htmlContent:html})})
      if(!r.ok)throw new Error(`Brevo error ${r.status}`)
      toast.success(`Emailed to ${s.email_recipient}`)
    }catch(err){toast.error('Email failed: '+err.message)}
    setEmailingOrder(null)
  }

  const openAddToSavedOrder = (orderId) => { setSavedItem(null);setSavedItemSearch('');setSavedQty('');setShowAddToOrder(orderId) }
  const confirmAddToSavedOrder = async () => {
    if(!savedItem){toast.error('Select item');return}
    if(!savedQty||Number(savedQty)<=0){toast.error('Enter quantity');return}
    setAddingToOrder(true)
    const{error}=await supabase.from('order_history_items').insert({order_id:showAddToOrder,item_id:savedItem.id,part_number:savedItem.part_number,item_name:savedItem.name,store_name:savedItem.stores?.name||'',unit:savedItem.unit,ordered_qty:Number(savedQty),received_qty:0})
    if(error){toast.error(error.message);setAddingToOrder(false);return}
    const{data}=await supabase.from('order_history_items').select('*').eq('order_id',showAddToOrder)
    setExpandedItems(p=>({...p,[showAddToOrder]:data||[]}))
    toast.success(`${savedItem.name} added`);setShowAddToOrder(null);setAddingToOrder(false)
  }

  // Receiving
  const loadReceiving = async () => {
    setRcvLoad(true)
    const{data}=await supabase.from('order_history').select('*').not('status','in','(received,cancelled)').order('delivery_date',{ascending:false}).limit(60)
    setRcvOrders(data||[]);setRcvLoad(false)
  }
  useEffect(()=>{if(tab==='receiving')loadReceiving()},[tab]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadRcvItems = async(orderId)=>{
    if(rcvExpanded===orderId){setRcvExpanded(null);return}
    if(!rcvItems[orderId]){
      const{data}=await supabase.from('order_history_items').select('*').eq('order_id',orderId)
      const init={};(data||[]).forEach(oi=>{init[oi.id]={qty:oi.received_qty||0,issue:oi.issue_type||'none'}})
      setRcvItems(p=>({...p,[orderId]:data||[]}));setRcvInput(p=>({...p,...init}))
    }
    setRcvExpanded(orderId)
  }

  const saveReceiving = async(order)=>{
    const oItems=rcvItems[order.id]||[];if(!oItems.length)return
    setRcvSaving(order.id)
    try{
      const records=[]
      for(const oi of oItems){
        const inp=rcvInput[oi.id]||{qty:0,issue:'none'},rcvQty=Number(inp.qty)||0,issue=inp.issue||'none'
        const approved=Number(oi.approved_qty||oi.ordered_qty)
        if(rcvQty>approved&&!['wrong_item','duplicate'].includes(issue)){
          if(!window.confirm(`${oi.item_name}: received ${rcvQty} > approved ${approved}. Continue?`)){setRcvSaving(null);return}
        }
        const recStatus=issue==='none'?'received':'exception'
        records.push({order_id:order.id,order_item_id:oi.id,item_id:oi.item_id,part_number:oi.part_number,item_name:oi.item_name,unit:oi.unit,store_name:oi.store_name,ordered_qty:oi.ordered_qty,approved_qty:oi.approved_qty||0,received_qty:rcvQty,issue_type:issue,status:recStatus,received_by:'System'})
        await supabase.from('order_history_items').update({received_qty:rcvQty,issue_type:issue,item_status:recStatus}).eq('id',oi.id)
      }
      await supabase.from('order_receiving_records').insert(records)
      const allRcv=oItems.every(oi=>Number(rcvInput[oi.id]?.qty||0)>=Number(oi.approved_qty||oi.ordered_qty))
      const someRcv=oItems.some(oi=>Number(rcvInput[oi.id]?.qty||0)>0)
      const hasExc=oItems.some(oi=>rcvInput[oi.id]?.issue&&rcvInput[oi.id].issue!=='none')
      const newStatus=hasExc?'exception':allRcv?'received':someRcv?'partially_received':'submitted'
      await supabase.from('order_history').update({status:newStatus}).eq('id',order.id)
      setRcvOrders(p=>p.map(o=>o.id===order.id?{...o,status:newStatus}:o))
      // Invalidate store cache so avg recalculates with received data next time
      Object.keys(storeItemsCache.current).forEach(k=>{delete storeItemsCache.current[k]})
      toast.success('Receiving saved!')
    }catch(err){toast.error(err.message)}
    setRcvSaving(null)
  }

  // Receiving History
  const loadRcvHistory = useCallback(async()=>{
    setRcvHistLoad(true)
    let q=supabase.from('order_receiving_records').select('*').order('received_at',{ascending:false}).limit(500)
    if(rcvHistFrom)q=q.gte('received_at',rcvHistFrom);if(rcvHistStatus)q=q.eq('status',rcvHistStatus)
    const{data}=await q;setRcvHistory(data||[]);setRcvHistLoad(false)
  },[rcvHistFrom,rcvHistStatus])
  useEffect(()=>{if(tab==='rcv-history')loadRcvHistory()},[tab,rcvHistFrom,rcvHistStatus]) // eslint-disable-line react-hooks/exhaustive-deps
  const rcvHistFiltered=useMemo(()=>{if(!rcvHistSearch.trim())return rcvHistory;const q=rcvHistSearch.toLowerCase();return rcvHistory.filter(r=>(r.item_name||'').toLowerCase().includes(q)||(r.part_number||'').toLowerCase().includes(q))},[rcvHistory,rcvHistSearch])

  // Requisitions
  const loadRequisitions=async()=>{
    setReqLoad(true)
    const{data}=await supabase.from('requisitions_import').select('*').order('imported_at',{ascending:false}).limit(200)
    setRequisitions(data||[])
    const{data:lastRow}=await supabase.from('requisitions_import').select('imported_at').order('imported_at',{ascending:false}).limit(1).single()
    if(lastRow)setLastSync(lastRow.imported_at);setReqLoad(false)
  }
  useEffect(()=>{if(tab==='requisitions')loadRequisitions()},[tab]) // eslint-disable-line react-hooks/exhaustive-deps

  const syncGoogleSheet=async()=>{
    setSyncing(true);setSyncResult(null)
    try{
      const resp=await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`).catch(()=>null)
      if(!resp||!resp.ok||(resp.headers.get('content-type')||'').includes('text/html')){toast.error('Sheet not public. Share → Anyone with link → Viewer');setSyncing(false);return}
      const text=await resp.text(),lines=text.trim().split('\n').filter(Boolean)
      if(lines.length<2){toast.error('Sheet appears empty');setSyncing(false);return}
      const parse=(line)=>{const r=[];let inQ=false,cur='';for(const ch of line){if(ch==='"')inQ=!inQ;else if(ch===','&&!inQ){r.push(cur.trim());cur=''}else cur+=ch}r.push(cur.trim());return r}
      const headers=parse(lines[0]).map(h=>h.toLowerCase().replace(/[^a-z0-9]/g,'_'))
      const sheetRows=lines.slice(1).map(line=>{const vals=parse(line);return Object.fromEntries(headers.map((h,i)=>[h,vals[i]||'']))})
      const col=(...names)=>names.find(n=>headers.includes(n))||null
      const reqNoCol=col('requisition_number','req_number','req_no'),partCol=col('part_number','part_no','part_','code','sku'),itemCol=col('item_name','item','description'),unitCol=col('unit','uom'),reqQtyCol=col('requested_qty','requested_quantity','qty'),appQtyCol=col('approved_qty','approved_quantity','approved'),statusCol=col('status')
      let newCount=0,matchedCount=0,unmatchedCount=0;const toInsert=[]
      for(const row of sheetRows){
        const partNumber=row[partCol]||'',itemName=row[itemCol]||''
        if(!partNumber&&!itemName)continue
        const hash=btoa(unescape(encodeURIComponent(`${row[reqNoCol]||''}::${partNumber}::${row[reqQtyCol]||''}::${row[appQtyCol]||''}`))).replace(/=/g,'')
        const{data:ex}=await supabase.from('requisitions_import').select('id').eq('sheet_row_hash',hash).single()
        if(ex){matchedCount++;continue}
        let orderItemId=null
        if(partNumber){const{data:mi}=await supabase.from('order_history_items').select('id').eq('part_number',partNumber).order('created_at',{ascending:false}).limit(1);orderItemId=mi?.[0]?.id||null}
        if(orderItemId)matchedCount++;else unmatchedCount++
        toInsert.push({sheet_row_hash:hash,requisition_number:row[reqNoCol]||null,part_number:partNumber||null,item_name:itemName||null,unit:row[unitCol]||null,requested_qty:Number(row[reqQtyCol])||0,approved_qty:Number(row[appQtyCol])||0,status:row[statusCol]||'pending',order_item_id:orderItemId,raw_data:row});newCount++
      }
      if(toInsert.length){
        await supabase.from('requisitions_import').insert(toInsert)
        for(const r of toInsert){if(r.order_item_id&&r.approved_qty>0)await supabase.from('order_history_items').update({approved_qty:r.approved_qty,item_status:'approved'}).eq('id',r.order_item_id)}
      }
      setSyncResult({new:newCount,matched:matchedCount,unmatched:unmatchedCount});setLastSync(new Date().toISOString())
      toast.success(`Sync done — ${newCount} new, ${matchedCount} matched, ${unmatchedCount} unmatched`);loadRequisitions()
    }catch(err){toast.error('Sync failed: '+err.message)}
    setSyncing(false)
  }

  const TABS=[{key:'order',label:'Create Order'},{key:'history',label:'Order History'},{key:'receiving',label:'Receiving'},{key:'rcv-history',label:'Receiving History'},{key:'requisitions',label:'Requisitions'}]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="page-title">Orders</h1>
          {tab==='order'&&<p className="page-sub">{selectedStore} · {fmtDate(deliveryDate)}</p>}
          {tab==='history'&&<p className="page-sub">All saved orders</p>}
          {tab==='receiving'&&<p className="page-sub">Pending receipt</p>}
          {tab==='rcv-history'&&<p className="page-sub">All receiving transactions</p>}
          {tab==='requisitions'&&<p className="page-sub">Google Sheet sync</p>}
        </div>
        <div className="flex gap-2 flex-wrap">
          {tab==='order'&&orderRows.length>0&&<>
            <button onClick={exportExcel} disabled={exportingXlsx} className="btn-secondary btn-sm"><FileSpreadsheet className="w-3.5 h-3.5"/>{exportingXlsx?'…':'Excel'}</button>
            <button onClick={exportPDF}   disabled={exportingPdf}  className="btn-secondary btn-sm"><FileText className="w-3.5 h-3.5"/>{exportingPdf?'…':'PDF'}</button>
            <Button onClick={saveOrder} loading={saving}><Save className="w-3.5 h-3.5"/> Save Order</Button>
          </>}
          {tab==='history'&&<button onClick={loadHistory} className="btn-secondary btn-sm"><RefreshCw className="w-3.5 h-3.5"/> Refresh</button>}
        </div>
      </div>

      <div className="flex border-b border-slate-700 overflow-x-auto">
        {TABS.map(({key,label})=>(
          <button key={key} onClick={()=>setTab(key)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${tab===key?'border-[#00AEEF] text-[#00AEEF]':'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ═══ CREATE ORDER ═══════════════════════════════════════════════════ */}
      {tab==='order'&&(
        <>
          <div className="card-sm space-y-3">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Select Store</p>
              <div className="flex gap-2 flex-wrap">
                {STORES.map(s=>(
                  <button key={s} onClick={()=>selectStore(s)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${selectedStore===s?'bg-teal-600 border-teal-600 text-white shadow-md shadow-teal-900/30':'bg-slate-800 border-slate-600 text-slate-300 hover:border-teal-600 hover:text-teal-300'}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap border-t border-slate-700/50 pt-3">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0"/>
              <span className="text-xs text-slate-400 uppercase tracking-wide">Delivery</span>
              <input type="date" value={deliveryDate} onChange={e=>setDeliveryDate(e.target.value)} className="input text-xs py-1 w-auto"/>
              <span className="text-xs text-slate-500 hidden sm:inline">{new Date(deliveryDate).toLocaleDateString('en-US',{weekday:'long',day:'numeric',month:'short',year:'numeric'})}</span>
            </div>
          </div>

          {loading&&<div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin"/></div>}
          {!loading&&rows.length===0&&<div className="card text-center py-14 text-slate-500"><ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-20"/><p className="font-medium">No items for this store</p></div>}

          {!loading&&rows.length>0&&(
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex gap-2">
                  {[{v:rows.length,l:'Items',c:'text-[#00AEEF]'},{v:orderRows.length,l:'To Order',c:'text-teal-400'},{v:orderRows.reduce((s,r)=>s+Number(r.ordered),0),l:'Units',c:'text-teal-300'}].map(({v,l,c})=>(
                    <div key={l} className="card-sm py-1.5 px-3 text-center"><p className={`text-lg font-bold ${c}`}>{v}</p><p className="text-slate-500 text-xs">{l}</p></div>
                  ))}
                </div>
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400"/>
                  <input className="input pl-8 text-xs" placeholder="Search items…" value={search} onChange={e=>setSearch(e.target.value)}/>
                  {search&&<button onClick={()=>setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500"><X className="w-3.5 h-3.5"/></button>}
                </div>
                <button onClick={()=>{setShowAddItem(true);setAddSearch('');setAddResults([])}}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-blue-700/40 bg-blue-900/10 text-blue-400 hover:bg-blue-900/30 transition-colors shrink-0">
                  <Plus className="w-3.5 h-3.5"/> Add Item
                </button>
              </div>

              <div className="card overflow-hidden p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="border-b border-slate-700 sticky top-0 bg-slate-800 z-10">
                      <tr>
                        <th className="px-2 py-2 text-left font-semibold text-slate-400 w-8">#</th>
                        <th className="px-2 py-2 text-left font-semibold text-slate-400 w-24">Part #</th>
                        <th className="px-2 py-2 text-left font-semibold text-slate-400">Item Name</th>
                        <th className="px-2 py-2 text-center font-semibold text-slate-400 w-14">UOM</th>
                        <th className="px-2 py-2 text-center font-semibold text-slate-400 w-24" title="Updates in real-time as you enter Physical Stock">Avg/Wk ↺</th>
                        <th className="px-2 py-2 text-center font-semibold text-slate-400 w-28">Physical Stock</th>
                        <th className="px-2 py-2 text-center font-semibold text-slate-400 w-36">Order Qty</th>
                        <th className="px-2 py-2 text-center font-semibold text-slate-400 w-20">Approved</th>
                        <th className="px-2 py-2 text-center font-semibold text-slate-400 w-16">Status</th>
                        <th className="w-6"/>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      {visibleRows.map(row=>(
                        <tr key={row.id} className={`transition-colors ${row.ordered>0?'bg-teal-900/10 border-l-2 border-l-teal-600':'hover:bg-slate-700/20'}`}>
                          <td className="px-2 py-1.5 text-slate-500 tabular-nums">{row.sl}</td>
                          <td className="px-2 py-1.5 font-mono text-slate-400">{codeOf(row.part_number)}</td>
                          <td className="px-2 py-1.5"><p className={`font-medium truncate max-w-[200px] ${row.ordered>0?'text-teal-200':'text-slate-100'}`}>{row.name}</p></td>
                          <td className="px-2 py-1.5 text-center"><span className="font-bold px-1.5 py-0.5 rounded bg-slate-700 text-teal-300 text-xs">{row.unit}</span></td>
                          <td className="px-2 py-1.5 text-center">
                            {row.avgConsumption!=null
                              ?<span className="text-blue-300 font-semibold tabular-nums">{row.avgConsumption}</span>
                              :<span className="text-slate-600 text-xs italic">—</span>}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <input type="number" min="0" step="any"
                              value={row.physStock===''?'':row.physStock}
                              onChange={e=>setPhysStockRT(row.id,e.target.value)}
                              placeholder="—"
                              className="w-20 border rounded px-2 py-1 text-center text-xs focus:outline-none focus:ring-1 focus:ring-purple-500 bg-slate-700 border-slate-600 text-purple-200 placeholder-slate-600"/>
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={()=>adjustQty(row.id,-1)} className="w-5 h-5 flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded text-slate-300 shrink-0"><Minus className="w-2.5 h-2.5"/></button>
                              <input type="number" min="0" value={row.ordered===0?'':row.ordered} onChange={e=>setQty(row.id,e.target.value)} placeholder="0"
                                className={`w-14 border rounded px-1 py-1 text-center text-xs font-medium focus:outline-none focus:ring-1 focus:ring-teal-500 ${row.ordered>0?'bg-teal-900/25 border-teal-600 text-teal-200':'bg-slate-700 border-slate-600 text-slate-100'}`}/>
                              <button onClick={()=>adjustQty(row.id,1)} className="w-5 h-5 flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded text-slate-300 shrink-0"><Plus className="w-2.5 h-2.5"/></button>
                              <span className="text-slate-500 text-xs ml-0.5 shrink-0">{row.unit}</span>
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-center">{row.approvedQty>0?<span className="text-emerald-400 font-semibold">{row.approvedQty}</span>:<span className="text-slate-600">—</span>}</td>
                          <td className="px-2 py-1.5 text-center"><Badge variant="gray" className="text-xs">draft</Badge></td>
                          <td className="px-2 py-1.5 text-center"><button onClick={()=>removeRow(row.id)} className="text-slate-600 hover:text-red-400 transition-colors"><X className="w-3.5 h-3.5"/></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {orderRows.length>0&&(
                <div className="flex items-center justify-between gap-3 px-4 py-3 card border-teal-700/30 bg-teal-900/10">
                  <p className="text-xs text-teal-300 font-medium">
                    <strong>{orderRows.length}</strong> items · <strong>{orderRows.reduce((s,r)=>s+Number(r.ordered),0)}</strong> units
                    {rows.filter(r=>r.physStock!==''&&r.physStock!=null).length>0&&<> · <strong>{rows.filter(r=>r.physStock!==''&&r.physStock!=null).length}</strong> physical count entries</>}
                  </p>
                  <div className="flex gap-2">
                    <button onClick={exportExcel} disabled={exportingXlsx} className="btn-secondary btn-sm"><FileSpreadsheet className="w-3 h-3"/>{exportingXlsx?'…':'Excel'}</button>
                    <button onClick={exportPDF}   disabled={exportingPdf}  className="btn-secondary btn-sm"><FileText className="w-3 h-3"/>{exportingPdf?'…':'PDF'}</button>
                    <Button onClick={saveOrder} loading={saving}><Save className="w-3.5 h-3.5"/> Save Order</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ═══ ORDER HISTORY ══════════════════════════════════════════════════ */}
      {tab==='history'&&(
        <div className="space-y-3">
          <div className="card-sm flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-40"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400"/><input className="input pl-8 text-xs w-full" placeholder="Search store, notes…" value={histSearch} onChange={e=>setHistSearch(e.target.value)}/></div>
            <select value={histStatus} onChange={e=>setHistStatus(e.target.value)} className="input text-xs py-1 w-auto"><option value="">All Statuses</option>{ORDER_STATUSES.map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}</select>
            <input type="date" value={histFrom} onChange={e=>setHistFrom(e.target.value)} className="input text-xs py-1 w-auto"/>
            <input type="date" value={histTo}   onChange={e=>setHistTo(e.target.value)}   className="input text-xs py-1 w-auto"/>
            <button onClick={()=>{setHistFrom('');setHistTo('');setHistStatus('');setHistSearch('')}} className="btn-ghost btn-sm"><X className="w-3.5 h-3.5"/> Clear</button>
          </div>
          {histLoad?<div className="flex justify-center py-14"><div className="w-9 h-9 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin"/></div>
            :histDateGroups.length===0?<div className="card text-center py-14 text-slate-500"><ShoppingCart className="w-10 h-10 mx-auto mb-3 opacity-20"/><p className="font-medium">No orders found</p></div>
            :histDateGroups.map(([date,dateOrders])=>(
              <div key={date} className="card border border-slate-700/40 p-0">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/40 bg-slate-800/60">
                  <div className="w-2 h-2 rounded-full bg-[#00AEEF] shrink-0"/><p className="font-semibold text-slate-100 text-sm">{fmtDate(date)}</p>
                  <span className="text-slate-500 text-xs">{dateOrders.length} order{dateOrders.length!==1?'s':''}</span>
                </div>
                <div className="divide-y divide-slate-700/30">
                  {dateOrders.map(order=>{
                    const oItems=expandedItems[order.id]||[],isExp=expanded===order.id
                    const sn=order.store_name||(order.notes||'').split(' · ')[0]||'Order'
                    return(<div key={order.id}>
                      <div className="flex items-center justify-between flex-wrap gap-2 px-3 py-2">
                        <button className="flex items-center gap-2 text-left flex-1 min-w-0" onClick={()=>loadExpandedItems(order.id)}>
                          {isExp?<ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0"/>:<ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0"/>}
                          <span className="font-medium text-slate-100 text-sm truncate">{sn}</span>
                          <Badge variant={STATUS_BADGE[order.status]||'gray'} className="text-xs">{(order.status||'').replace(/_/g,' ')}</Badge>
                          {oItems.length>0&&<span className="text-slate-500 text-xs shrink-0">{oItems.length} items</span>}
                        </button>
                        <div className="flex gap-1.5 items-center flex-wrap">
                          <button onClick={()=>openAddToSavedOrder(order.id)} className="flex items-center gap-1 px-2 py-1 text-xs text-blue-400 border border-blue-700/30 bg-blue-900/10 hover:bg-blue-900/30 rounded transition-colors"><PlusCircle className="w-3 h-3"/> Add</button>
                          {isExp&&oItems.length>0&&<>
                            <button onClick={()=>exportHistoryExcel(order)} disabled={exportingHistXlsx===order.id} className="flex items-center gap-1 px-2 py-1 text-xs text-emerald-400 border border-emerald-700/30 bg-emerald-900/10 hover:bg-emerald-900/30 rounded disabled:opacity-50"><FileSpreadsheet className="w-3 h-3"/>{exportingHistXlsx===order.id?'…':'Excel'}</button>
                            <button onClick={()=>exportHistoryPDF(order)}   disabled={exportingHistPdf===order.id}  className="flex items-center gap-1 px-2 py-1 text-xs text-rose-400 border border-rose-700/30 bg-rose-900/10 hover:bg-rose-900/30 rounded disabled:opacity-50"><FileText className="w-3 h-3"/>{exportingHistPdf===order.id?'…':'PDF'}</button>
                            <button onClick={()=>emailOrder(order)}         disabled={emailingOrder===order.id}      className="flex items-center gap-1 px-2 py-1 text-xs text-purple-400 border border-purple-700/30 bg-purple-900/10 hover:bg-purple-900/30 rounded disabled:opacity-50"><Mail className="w-3 h-3"/>{emailingOrder===order.id?'…':'Email'}</button>
                          </>}
                        </div>
                      </div>
                      {isExp&&oItems.length>0&&(
                        <div className="border-t border-slate-700/30 overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead className="bg-slate-800/50"><tr>
                              {['SL','Part #','Item','UOM','Ordered','Approved','Received','Status'].map(h=><th key={h} className="px-2 py-1.5 text-left font-semibold text-slate-400 whitespace-nowrap">{h}</th>)}
                            </tr></thead>
                            <tbody className="divide-y divide-slate-700/30">
                              {oItems.map((oi,idx)=>{const sf=Number(oi.ordered_qty)-Number(oi.received_qty);return(
                                <tr key={oi.id} className={sf<=0?'opacity-60':''}>
                                  <td className="px-2 py-1 text-slate-500">{idx+1}</td>
                                  <td className="px-2 py-1 font-mono text-slate-300">{codeOf(oi.part_number)}</td>
                                  <td className="px-2 py-1 text-slate-100 max-w-[160px] truncate">{oi.item_name}</td>
                                  <td className="px-2 py-1 text-center"><span className="px-1.5 py-0.5 rounded bg-slate-700 text-teal-300 font-bold text-xs">{oi.unit}</span></td>
                                  <td className="px-2 py-1 text-center text-teal-400 font-bold">{oi.ordered_qty}</td>
                                  <td className="px-2 py-1 text-center text-emerald-400">{oi.approved_qty||'—'}</td>
                                  <td className="px-2 py-1 text-center text-slate-300">{oi.received_qty}</td>
                                  <td className="px-2 py-1 text-center"><Badge variant={sf<=0?'green':Number(oi.received_qty)>0?'orange':'yellow'} className="text-xs">{sf<=0?'Received':Number(oi.received_qty)>0?'Partial':'Pending'}</Badge></td>
                                </tr>
                              )})}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>)
                  })}
                </div>
              </div>
            ))
          }
        </div>
      )}

      {/* ═══ RECEIVING ══════════════════════════════════════════════════════ */}
      {tab==='receiving'&&(
        <div className="space-y-3">
          <p className="text-xs text-slate-400">Enter received quantities per item. This does NOT update main inventory.</p>
          {rcvLoad?<div className="flex justify-center py-14"><div className="w-9 h-9 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin"/></div>
            :rcvOrders.length===0?<div className="card text-center py-14 text-slate-500"><Inbox className="w-10 h-10 mx-auto mb-3 opacity-20"/><p className="font-medium">No pending orders to receive</p></div>
            :rcvOrders.map(order=>{
              const sn=order.store_name||(order.notes||'').split(' · ')[0]||'Order',isExp=rcvExpanded===order.id,oItems=rcvItems[order.id]||[]
              return(<div key={order.id} className="card border border-slate-700/40 p-0">
                <div className="flex items-center justify-between flex-wrap gap-2 px-3 py-2 border-b border-slate-700/40 bg-slate-800/60">
                  <button className="flex items-center gap-2 flex-1 text-left" onClick={()=>loadRcvItems(order.id)}>
                    {isExp?<ChevronDown className="w-3.5 h-3.5 text-slate-400"/>:<ChevronRight className="w-3.5 h-3.5 text-slate-400"/>}
                    <span className="font-medium text-slate-100 text-sm">{sn}</span>
                    <Badge variant={STATUS_BADGE[order.status]||'gray'} className="text-xs">{(order.status||'').replace(/_/g,' ')}</Badge>
                    <span className="text-slate-500 text-xs">{fmtDate(order.delivery_date)}</span>
                  </button>
                  {isExp&&oItems.length>0&&<Button onClick={()=>saveReceiving(order)} loading={rcvSaving===order.id}><CheckCircle2 className="w-3.5 h-3.5"/> Save Receiving</Button>}
                </div>
                {isExp&&<div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-800/50"><tr>
                      {['Part #','Item','UOM','Ordered','Approved','Received Qty','Issue'].map(h=><th key={h} className="px-2 py-1.5 text-left font-semibold text-slate-400 whitespace-nowrap">{h}</th>)}
                    </tr></thead>
                    <tbody className="divide-y divide-slate-700/30">
                      {oItems.map(oi=>{const inp=rcvInput[oi.id]||{qty:0,issue:'none'};return(
                        <tr key={oi.id}>
                          <td className="px-2 py-1.5 font-mono text-slate-300">{codeOf(oi.part_number)}</td>
                          <td className="px-2 py-1.5 text-slate-100 max-w-[160px] truncate">{oi.item_name}</td>
                          <td className="px-2 py-1.5 text-center"><span className="px-1.5 py-0.5 rounded bg-slate-700 text-teal-300 font-bold">{oi.unit}</span></td>
                          <td className="px-2 py-1.5 text-center text-teal-400 font-bold">{oi.ordered_qty}</td>
                          <td className="px-2 py-1.5 text-center text-emerald-400">{oi.approved_qty||'—'}</td>
                          <td className="px-2 py-1.5 text-center">
                            <input type="number" min="0" value={inp.qty}
                              onChange={e=>setRcvInput(p=>({...p,[oi.id]:{...inp,qty:Math.max(0,Number(e.target.value))}}))}
                              className="w-20 border rounded px-2 py-1 text-center text-xs bg-slate-700 border-slate-600 text-slate-100 focus:outline-none focus:ring-1 focus:ring-teal-500"/>
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <select value={inp.issue} onChange={e=>setRcvInput(p=>({...p,[oi.id]:{...inp,issue:e.target.value}}))}
                              className={`input text-xs py-0.5 w-auto ${inp.issue!=='none'?'border-amber-600 text-amber-300':''}`}>
                              {ISSUE_TYPES.map(t=><option key={t} value={t}>{ISSUE_LABELS[t]}</option>)}
                            </select>
                          </td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>}
              </div>)
            })
          }
        </div>
      )}

      {/* ═══ RECEIVING HISTORY ══════════════════════════════════════════════ */}
      {tab==='rcv-history'&&(
        <div className="space-y-3">
          <div className="card-sm flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-40"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400"/><input className="input pl-8 text-xs w-full" placeholder="Search item, part #…" value={rcvHistSearch} onChange={e=>setRcvHistSearch(e.target.value)}/></div>
            <select value={rcvHistStatus} onChange={e=>setRcvHistStatus(e.target.value)} className="input text-xs py-1 w-auto"><option value="">All Statuses</option><option value="received">Received</option><option value="exception">Exception</option></select>
            <input type="date" value={rcvHistFrom} onChange={e=>setRcvHistFrom(e.target.value)} className="input text-xs py-1 w-auto"/>
            <button onClick={()=>{setRcvHistSearch('');setRcvHistFrom('');setRcvHistStatus('')}} className="btn-ghost btn-sm"><X className="w-3.5 h-3.5"/> Clear</button>
          </div>
          {rcvHistLoad?<div className="flex justify-center py-14"><div className="w-9 h-9 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin"/></div>
            :rcvHistFiltered.length===0?<div className="card text-center py-14 text-slate-500"><Inbox className="w-10 h-10 mx-auto mb-3 opacity-20"/><p className="font-medium">No receiving records yet</p></div>
            :<div className="card overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full text-xs">
              <thead className="bg-slate-800 border-b border-slate-700 sticky top-0"><tr>{['Received','Part #','Item Name','UOM','Ordered','Approved','Received Qty','Issue','Status','By'].map(h=><th key={h} className="px-2 py-2 text-left font-semibold text-slate-400 whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-700/30">{rcvHistFiltered.map(r=>(
                <tr key={r.id} className="hover:bg-slate-700/20">
                  <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{fmtDate(r.received_at?.split('T')[0])}</td>
                  <td className="px-2 py-1.5 font-mono text-slate-300">{codeOf(r.part_number)}</td>
                  <td className="px-2 py-1.5 text-slate-100 max-w-[140px] truncate">{r.item_name}</td>
                  <td className="px-2 py-1.5 text-center"><span className="px-1.5 py-0.5 rounded bg-slate-700 text-teal-300 font-bold">{r.unit}</span></td>
                  <td className="px-2 py-1.5 text-center text-teal-400 font-bold">{r.ordered_qty}</td>
                  <td className="px-2 py-1.5 text-center text-emerald-400">{r.approved_qty||'—'}</td>
                  <td className="px-2 py-1.5 text-center font-bold text-slate-100">{r.received_qty}</td>
                  <td className="px-2 py-1.5">{r.issue_type&&r.issue_type!=='none'?<Badge variant="orange" className="text-xs">{ISSUE_LABELS[r.issue_type]||r.issue_type}</Badge>:<span className="text-slate-600">—</span>}</td>
                  <td className="px-2 py-1.5"><Badge variant={r.status==='received'?'green':'red'} className="text-xs">{r.status}</Badge></td>
                  <td className="px-2 py-1.5 text-slate-400">{r.received_by||'—'}</td>
                </tr>
              ))}</tbody>
            </table></div></div>
          }
        </div>
      )}

      {/* ═══ REQUISITIONS ═══════════════════════════════════════════════════ */}
      {tab==='requisitions'&&(
        <div className="space-y-4">
          <div className="card-sm space-y-3">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="font-semibold text-slate-100 text-sm flex items-center gap-2"><Link className="w-4 h-4 text-[#00AEEF]"/> Google Sheet Requisitions</p>
                <p className="text-xs text-slate-400 mt-1">Syncs approved requisitions from your Google Sheet.</p>
                {lastSync&&<p className="text-xs text-slate-500 mt-1">Last sync: {fmtDateTime(lastSync)}</p>}
              </div>
              <Button onClick={syncGoogleSheet} loading={syncing}><RefreshCw className="w-3.5 h-3.5"/> Sync Requisitions</Button>
            </div>
            {syncResult&&<div className="grid grid-cols-3 gap-2 border-t border-slate-700/50 pt-3">{[{l:'New Imported',v:syncResult.new,c:'text-teal-400'},{l:'Matched',v:syncResult.matched,c:'text-blue-400'},{l:'Unmatched',v:syncResult.unmatched,c:'text-amber-400'}].map(({l,v,c})=><div key={l} className="text-center"><p className={`text-xl font-bold ${c}`}>{v}</p><p className="text-xs text-slate-500">{l}</p></div>)}</div>}
            <div className="border-t border-slate-700/50 pt-3 text-xs text-slate-500 space-y-1">
              <p className="font-semibold text-slate-400">To enable sync:</p>
              <ol className="list-decimal list-inside space-y-0.5 ml-1"><li>Open the Google Sheet</li><li>Share → Anyone with the link → Viewer</li><li>Click Sync Requisitions above</li></ol>
              <p className="mt-1">Sheet: <a href={`https://docs.google.com/spreadsheets/d/${SHEET_ID}`} target="_blank" rel="noreferrer" className="text-[#00AEEF] underline underline-offset-2">Open in Google Sheets</a></p>
            </div>
          </div>
          {reqLoad?<div className="flex justify-center py-10"><div className="w-8 h-8 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin"/></div>
            :requisitions.length===0?<div className="card text-center py-12 text-slate-500"><AlertTriangle className="w-10 h-10 mx-auto mb-3 opacity-20"/><p className="font-medium">No requisitions imported yet</p><p className="text-xs mt-1">Make the Google Sheet public and click Sync.</p></div>
            :<div className="card overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full text-xs">
              <thead className="bg-slate-800 border-b border-slate-700 sticky top-0"><tr>{['Req #','Part #','Item Name','Unit','Requested','Approved','Status','Imported'].map(h=><th key={h} className="px-2 py-2 text-left font-semibold text-slate-400 whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-700/30">{requisitions.map(r=>(
                <tr key={r.id} className="hover:bg-slate-700/20">
                  <td className="px-2 py-1.5 text-slate-300 font-mono">{r.requisition_number||'—'}</td>
                  <td className="px-2 py-1.5 font-mono text-slate-300">{codeOf(r.part_number)||'—'}</td>
                  <td className="px-2 py-1.5 text-slate-100 max-w-[160px] truncate">{r.item_name||'—'}</td>
                  <td className="px-2 py-1.5 text-center">{r.unit||'—'}</td>
                  <td className="px-2 py-1.5 text-center text-teal-400 font-bold">{r.requested_qty}</td>
                  <td className="px-2 py-1.5 text-center text-emerald-400 font-bold">{r.approved_qty||'—'}</td>
                  <td className="px-2 py-1.5"><Badge variant={STATUS_BADGE[r.status]||'gray'} className="text-xs">{r.status}</Badge></td>
                  <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">{fmtDate(r.imported_at?.split('T')[0])}</td>
                </tr>
              ))}</tbody>
            </table></div></div>
          }
        </div>
      )}

      {/* ═══ MODAL: + Add item to current order ════════════════════════════ */}
      {showAddItem&&(
        <Modal isOpen onClose={()=>setShowAddItem(false)} title="Add Item to Order" size="sm"
          footer={<Button variant="secondary" onClick={()=>setShowAddItem(false)}>Close</Button>}>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400"/>
              <input className="input pl-8 text-sm w-full" placeholder="Search all inventory by name or part #…"
                value={addSearch} onChange={e=>setAddSearch(e.target.value)} autoFocus/>
              {addSearch&&<button onClick={()=>{setAddSearch('');setAddResults([])}} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500"><X className="w-3.5 h-3.5"/></button>}
            </div>
            {addLoading&&<p className="text-xs text-slate-500 text-center py-2">Searching…</p>}
            {!addLoading&&addResults.length===0&&addSearch.trim()&&<p className="text-xs text-slate-500 text-center py-3">No items found</p>}
            {!addLoading&&addResults.length===0&&!addSearch.trim()&&<p className="text-xs text-slate-500 text-center py-4">Type to search all inventory items</p>}
            {addResults.length>0&&(
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-700/30 border border-slate-700/50 rounded-lg">
                {addResults.map(item=>{
                  const already=rows.some(r=>r.id===item.id)
                  return(<button key={item.id} onClick={()=>!already&&addItemToOrder(item)} disabled={already}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-700/40 transition-colors ${already?'opacity-40 cursor-not-allowed':''}`}>
                    <span className="font-mono text-xs text-[#00AEEF] w-16 shrink-0">{codeOf(item.part_number)}</span>
                    <span className="flex-1 text-slate-200 text-sm truncate">{item.name}</span>
                    <span className="text-slate-500 text-xs shrink-0">{item.unit}</span>
                    {already&&<span className="text-slate-600 text-xs shrink-0">added</span>}
                  </button>)
                })}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ═══ MODAL: Add item to saved history order ═════════════════════════ */}
      {showAddToOrder&&(
        <Modal isOpen onClose={()=>setShowAddToOrder(null)} title="Add Item to Saved Order" size="sm"
          footer={<><Button variant="secondary" onClick={()=>setShowAddToOrder(null)}>Cancel</Button><Button onClick={confirmAddToSavedOrder} loading={addingToOrder}>Add Item</Button></>}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Item *</label>
              {savedItem?(
                <div className="input bg-slate-700/50 flex items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-[#00AEEF]">{savedItem.part_number}</span>
                  <span className="flex-1 text-slate-100">{savedItem.name}</span>
                  <span className="text-slate-400 text-xs">{savedItem.unit}</span>
                  <button onClick={()=>{setSavedItem(null);setSavedItemSearch('')}}><X className="w-3.5 h-3.5 text-slate-400"/></button>
                </div>
              ):(
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400"/>
                  <input className="input pl-8 text-sm w-full" placeholder="Search by name or part #…" value={savedItemSearch} onChange={e=>setSavedItemSearch(e.target.value)} autoFocus/>
                </div>
              )}
            </div>
            <Input label={`Quantity *${savedItem?` (${savedItem.unit})`:''}`} type="number" min="1" value={savedQty} onChange={e=>setSavedQty(e.target.value)}/>
          </div>
        </Modal>
      )}
    </div>
  )
}
