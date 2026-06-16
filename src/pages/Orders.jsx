import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { ShoppingCart, Download, RefreshCw, Minus, Plus, Save, ChevronDown, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'

// ── Delivery day logic ────────────────────────────────────
function nextDelivery() {
  const today=new Date(); const day=today.getDay()
  const targets=[1,4]; let minDiff=8; let next=null
  for (const t of targets) {
    let diff=(t-day+7)%7; if(diff===0) diff=7
    if(diff<minDiff){ minDiff=diff; next=t }
  }
  const d=new Date(today); d.setDate(d.getDate()+minDiff)
  return { date:d, label:d.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'}) }
}
function weekRange(weeksBack=0) {
  const now=new Date(); const toDate=new Date(now); toDate.setDate(toDate.getDate()-weeksBack*7)
  const frDate=new Date(toDate); frDate.setDate(frDate.getDate()-7)
  return { from:frDate.toISOString().split('T')[0], to:toDate.toISOString().split('T')[0] }
}

const STATUS_BADGE = { pending:'yellow', partial:'orange', received:'green', cancelled:'red' }

export default function Orders() {
  const [tab,       setTab]       = useState('generate') // 'generate' | 'history'
  const [rows,      setRows]      = useState([])
  const [delivery,  setDelivery]  = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [exporting, setExporting] = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [resortName,setResortName]= useState('Outrigger Maafushivaru Resort')
  // History
  const [history,   setHistory]   = useState([])
  const [histLoad,  setHistLoad]  = useState(false)
  const [expanded,  setExpanded]  = useState(null)
  const [expandedItems,setExpandedItems]=useState({})
  const [markingId, setMarkingId] = useState(null)

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      const { data: settings } = await supabase.from('settings').select('key,value')
      const smap=(settings||[]).reduce((a,s)=>({...a,[s.key]:s.value}),{})
      if (smap.resort_name) setResortName(smap.resort_name)

      const { data: items } = await supabase.from('items').select('*, stores(name,category)')
      const tw=weekRange(0); const lw=weekRange(1)
      const { data: thisIss } = await supabase.from('issuances').select('item_id,quantity_issued').gte('date',tw.from).lte('date',tw.to)
      const { data: lastIss } = await supabase.from('issuances').select('item_id,quantity_issued').gte('date',lw.from).lte('date',lw.to)

      const sum=(list,id)=>(list||[]).filter(i=>i.item_id===id).reduce((s,i)=>s+Number(i.quantity_issued),0)

      const orderRows=(items||[]).map(item=>{
        const thisTotal=sum(thisIss,item.id); const lastTotal=sum(lastIss,item.id)
        const avgWeekly=(thisTotal+lastTotal)/2
        const suggested=Math.max(0,Math.ceil(avgWeekly*2-Number(item.current_stock)))
        return { id:item.id, part_number:item.part_number, name:item.name, store:item.stores?.name||'', category:item.stores?.category||'', unit:item.unit, current_stock:item.current_stock, min_stock:item.min_stock, thisWeek:thisTotal, lastWeek:lastTotal, avgWeekly:Math.round(avgWeekly*10)/10, suggested, ordered:suggested }
      }).filter(r=>r.suggested>0||r.current_stock<=r.min_stock)
        .sort((a,b)=>a.store.localeCompare(b.store)||a.name.localeCompare(b.name))

      setRows(orderRows); setDelivery(nextDelivery())
    } catch(err) { toast.error('Failed: '+err.message) }
    setLoading(false)
  }, [])

  const adjustQty=(id,delta)=>setRows(prev=>prev.map(r=>r.id===id?{...r,ordered:Math.max(0,(r.ordered||0)+delta)}:r))
  const setQty=(id,val)=>{ const n=parseInt(val,10); if(!isNaN(n)&&n>=0) setRows(prev=>prev.map(r=>r.id===id?{...r,ordered:n}:r)) }

  const exportPDF = async () => {
    if (!rows.length||!delivery) return
    setExporting(true)
    try {
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc=new jsPDF({unit:'mm',format:'a4'})
      const primary=[15,118,110]
      const delivDay=delivery.date.toLocaleDateString('en-US',{weekday:'long'})
      const delivDate=delivery.date.toLocaleDateString('en-US',{day:'numeric',month:'long',year:'numeric'})
      doc.setFillColor(...primary); doc.rect(0,0,210,28,'F')
      doc.setTextColor(255,255,255); doc.setFontSize(18); doc.setFont('helvetica','bold')
      doc.text(resortName,14,12); doc.setFontSize(13); doc.setFont('helvetica','normal')
      doc.text(`Order for ${delivDay} – ${delivDate}`,14,21)
      doc.text(`Generated: ${new Date().toLocaleDateString('en-US',{dateStyle:'medium'})}`,14,27)
      const grouped=rows.reduce((acc,r)=>{ (acc[r.store]=acc[r.store]||[]).push(r); return acc },{})
      let y=36
      for (const [store,items] of Object.entries(grouped)) {
        doc.setTextColor(0,0,0); doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.text(store,14,y)
        autoTable(doc,{ startY:y+3, head:[['Part #','Item','Unit','Stock','Avg/Wk','Suggested','Order Qty']], body:items.map(i=>[i.part_number,i.name,i.unit,i.current_stock,i.avgWeekly,i.suggested,i.ordered]), headStyles:{fillColor:primary,fontSize:9}, styles:{fontSize:9}, alternateRowStyles:{fillColor:[248,250,252]} })
        y=doc.lastAutoTable.finalY+8
      }
      doc.save(`Order_${delivDay}_${delivery.date.toISOString().split('T')[0]}.pdf`)
      toast.success('Order PDF exported')
    } catch(err) { toast.error('Export failed: '+err.message) }
    setExporting(false)
  }

  const saveOrder = async () => {
    const toOrder=rows.filter(r=>r.ordered>0)
    if (!toOrder.length) { toast.error('No items to save (all quantities are 0)'); return }
    if (!delivery) return
    setSaving(true)
    try {
      const { data: order } = await supabase.from('order_history').insert({
        delivery_date: delivery.date.toISOString().split('T')[0],
        delivery_day:  delivery.date.toLocaleDateString('en-US',{weekday:'long'}),
        status: 'pending',
        created_by: 'System',
        notes: `Auto-generated order for ${delivery.label}`,
      }).select().single()
      const itemRows=toOrder.map(r=>({ order_id:order.id, item_id:r.id, part_number:r.part_number, item_name:r.name, store_name:r.store, unit:r.unit, ordered_qty:r.ordered, received_qty:0 }))
      await supabase.from('order_history_items').insert(itemRows)
      toast.success(`Order saved for ${delivery.label} (${toOrder.length} items)`)
    } catch(err) { toast.error(err.message) }
    setSaving(false)
  }

  const loadHistory = async () => {
    setHistLoad(true)
    const { data } = await supabase.from('order_history').select('*').order('created_at',{ascending:false}).limit(30)
    setHistory(data||[])
    setHistLoad(false)
  }

  const loadExpandedItems = async (id) => {
    if (expandedItems[id]) { setExpanded(expanded===id?null:id); return }
    const { data } = await supabase.from('order_history_items').select('*').eq('order_id',id)
    setExpandedItems(p=>({...p,[id]:data||[]}))
    setExpanded(id)
  }

  const markReceived = async (orderId) => {
    const orderItems = expandedItems[orderId]||[]
    if (!orderItems.length) { toast.error('Load the order items first'); return }
    if (!confirm(`Mark all items in this order as fully received? This will update stock levels.`)) return
    setMarkingId(orderId)
    try {
      for (const oi of orderItems) {
        if (!oi.item_id||!oi.ordered_qty) continue
        const { data: item } = await supabase.from('items').select('current_stock').eq('id',oi.item_id).single()
        if (!item) continue
        const newStock = Number(item.current_stock)+Number(oi.ordered_qty)
        await supabase.from('items').update({ current_stock:newStock }).eq('id',oi.item_id)
        await supabase.from('stock_updates').insert({ item_id:oi.item_id, date:new Date().toISOString().split('T')[0], quantity_change:Number(oi.ordered_qty), new_quantity:newStock, updated_by:'Order Received', note:`Order received from GRN` })
        await supabase.from('order_history_items').update({ received_qty:oi.ordered_qty }).eq('id',oi.id)
      }
      await supabase.from('order_history').update({ status:'received' }).eq('id',orderId)
      setHistory(prev=>prev.map(o=>o.id===orderId?{...o,status:'received'}:o))
      toast.success('Order marked as received. Stock levels updated!')
    } catch(err) { toast.error(err.message) }
    setMarkingId(null)
  }

  const switchToHistory = () => { setTab('history'); loadHistory() }

  const toOrder = rows.filter(r=>r.ordered>0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Order Sheet</h1>
          {delivery&&tab==='generate'&&<p className="page-sub">Next delivery: <strong className="text-teal-400">{delivery.label}</strong></p>}
        </div>
        <div className="flex gap-2 flex-wrap">
          {rows.length>0&&tab==='generate'&&(
            <>
              <Button variant="secondary" onClick={exportPDF} loading={exporting}><Download className="w-4 h-4" /> PDF</Button>
              <Button variant="secondary" onClick={saveOrder} loading={saving}><Save className="w-4 h-4" /> Save Order</Button>
            </>
          )}
          {tab==='generate' ? (
            <Button onClick={generate} loading={loading}><RefreshCw className="w-4 h-4" /> Generate</Button>
          ) : (
            <Button onClick={()=>setTab('generate')}>← Generate New</Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-700">
        {[{key:'generate',label:'Generate Order'},{key:'history',label:'Order History'}].map(({key,label})=>(
          <button key={key} onClick={()=>key==='history'?switchToHistory():setTab(key)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${tab===key?'border-teal-500 text-teal-400':'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Generate tab ─────────────────────────────────── */}
      {tab==='generate'&&(
        <>
          {!rows.length&&!loading&&(
            <div className="card text-center py-20 text-slate-500">
              <ShoppingCart className="w-14 h-14 mx-auto mb-4 opacity-20" />
              <p className="font-medium text-lg">No order generated yet</p>
              <p className="text-sm mt-1">Click "Generate" to calculate suggested quantities from usage history.</p>
            </div>
          )}
          {loading&&<div className="flex justify-center py-20"><div className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" /></div>}
          {rows.length>0&&!loading&&(
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="card-sm text-center"><p className="text-2xl font-bold text-teal-400">{rows.length}</p><p className="text-slate-400 text-sm mt-1">Items to order</p></div>
                <div className="card-sm text-center"><p className="text-2xl font-bold text-teal-400">{toOrder.reduce((s,r)=>s+r.ordered,0)}</p><p className="text-slate-400 text-sm mt-1">Total units</p></div>
                <div className="card-sm text-center col-span-2 sm:col-span-1">
                  <p className="font-medium text-slate-100">{delivery?.date.toLocaleDateString('en-US',{weekday:'long'})}</p>
                  <p className="text-slate-400 text-sm mt-1">{delivery?.date.toLocaleDateString('en-US',{day:'numeric',month:'short',year:'numeric'})}</p>
                </div>
              </div>
              <div className="card">
                <p className="text-xs text-slate-400 mb-4">Formula: Suggested = (Avg weekly usage × 2) − Current Stock. Adjust quantities as needed.</p>
                <Table>
                  <Thead><tr><Th>Part #</Th><Th>Item Name</Th><Th>Store</Th><Th>Unit</Th><Th>Current</Th><Th>Avg/Wk</Th><Th>Suggested</Th><Th>Order Qty</Th></tr></Thead>
                  <Tbody>
                    {rows.map(row=>(
                      <Tr key={row.id} className={row.ordered===0?'opacity-50':''}>
                        <Td className="font-mono text-xs text-slate-300">{row.part_number}</Td>
                        <Td className="font-medium text-slate-100 max-w-xs truncate">{row.name}</Td>
                        <Td><span className="text-xs text-slate-400">{row.store}</span></Td>
                        <Td className="text-slate-400 text-xs">{row.unit}</Td>
                        <Td className={Number(row.current_stock)<=Number(row.min_stock)?'text-red-400 font-semibold':'text-slate-300'}>{row.current_stock}</Td>
                        <Td className="text-slate-300">{row.avgWeekly}</Td>
                        <Td><Badge variant="teal">{row.suggested}</Badge></Td>
                        <Td>
                          <div className="flex items-center gap-1">
                            <button onClick={()=>adjustQty(row.id,-1)} className="w-7 h-7 flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-slate-300"><Minus className="w-3 h-3" /></button>
                            <input type="number" min="0" value={row.ordered} onChange={e=>setQty(row.id,e.target.value)} className="w-16 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-center text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                            <button onClick={()=>adjustQty(row.id,1)} className="w-7 h-7 flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-slate-300"><Plus className="w-3 h-3" /></button>
                          </div>
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

      {/* ── History tab ──────────────────────────────────── */}
      {tab==='history'&&(
        <div className="space-y-3">
          {histLoad ? (
            <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : history.length===0 ? (
            <div className="card text-center py-16 text-slate-500"><ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-20" /><p className="font-medium">No saved orders yet</p><p className="text-sm mt-1">Generate an order and click "Save Order" to archive it here.</p></div>
          ) : (
            history.map(order=>(
              <div key={order.id} className="card border border-slate-700/40">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <button className="flex items-center gap-3 text-left flex-1" onClick={()=>loadExpandedItems(order.id)}>
                    {expanded===order.id?<ChevronDown className="w-4 h-4 text-slate-400 shrink-0"/>:<ChevronRight className="w-4 h-4 text-slate-400 shrink-0"/>}
                    <div>
                      <p className="font-semibold text-slate-100">Order for {order.delivery_day} · {order.delivery_date}</p>
                      <p className="text-xs text-slate-400 mt-0.5">Saved {new Date(order.created_at).toLocaleDateString()}</p>
                    </div>
                    <Badge variant={STATUS_BADGE[order.status]||'gray'} className="ml-2">{order.status}</Badge>
                  </button>
                  {order.status==='pending'&&(
                    <Button onClick={()=>{ loadExpandedItems(order.id); setTimeout(()=>markReceived(order.id),500) }} loading={markingId===order.id} variant="secondary">
                      ✓ Mark Received
                    </Button>
                  )}
                </div>
                {expanded===order.id&&expandedItems[order.id]&&(
                  <div className="mt-3 pt-3 border-t border-slate-700/40">
                    <Table>
                      <Thead><tr><Th>Part #</Th><Th>Item</Th><Th>Store</Th><Th>Ordered</Th><Th>Received</Th></tr></Thead>
                      <Tbody>
                        {expandedItems[order.id].map(oi=>(
                          <Tr key={oi.id}>
                            <Td className="font-mono text-xs text-slate-300">{oi.part_number}</Td>
                            <Td className="font-medium text-slate-100 max-w-xs truncate">{oi.item_name}</Td>
                            <Td className="text-slate-400 text-xs">{oi.store_name}</Td>
                            <Td className="text-teal-400 font-semibold">{oi.ordered_qty} <span className="text-slate-500 text-xs font-normal">{oi.unit}</span></Td>
                            <Td className={Number(oi.received_qty)>0?'text-green-400 font-semibold':'text-slate-500'}>{Number(oi.received_qty)>0?`${oi.received_qty} ${oi.unit}`:'Pending'}</Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
