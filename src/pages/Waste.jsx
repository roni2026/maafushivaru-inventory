import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase, selectAll } from '../lib/supabase'
import { Trash2, Plus, Download, Search, RefreshCw } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from 'recharts'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import Input, { Select } from '../components/ui/Input'

const REASONS = ['Expired','Damaged','Contamination','Over-Production','Other']
const REASON_COLOR  = { Expired:'#ef4444', Damaged:'#f97316', Contamination:'#a855f7', 'Over-Production':'#eab308', Other:'#64748b' }
const REASON_BADGE  = { Expired:'red',     Damaged:'orange',  Contamination:'purple',  'Over-Production':'yellow', Other:'gray'    }

const fmtDate = (n=0) => { const d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().split('T')[0] }

export default function Waste() {
  const [wasteLog,     setWasteLog]     = useState([])
  const [items,        setItems]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [showModal,    setShowModal]    = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [search,       setSearch]       = useState('')
  const [filterReason, setFilterReason] = useState('')
  const [dateFrom,     setDateFrom]     = useState(fmtDate(30))
  const [dateTo,       setDateTo]       = useState(fmtDate(0))
  // form
  const [query,    setQuery]    = useState('')
  const [itemSel,  setItemSel]  = useState(null)
  const [qty,      setQty]      = useState('')
  const [reason,   setReason]   = useState('Expired')
  const [date,     setDate]     = useState(fmtDate(0))
  const [cost,     setCost]     = useState('')
  const [logBy,    setLogBy]    = useState('')
  const [notes,    setNotes]    = useState('')
  const [showSug,  setShowSug]  = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: wl }, { data: it }] = await Promise.all([
      supabase.from('waste_log')
        .select('*, items(name, part_number, unit, stores(name))')
        .gte('date', dateFrom).lte('date', dateTo)
        .order('date', { ascending:false }).order('created_at', { ascending:false }),
      selectAll(() => supabase.from('items').select('id,name,part_number,unit,current_stock,unit_cost,stores(name)').eq('active', true).order('name')),
    ])
    setWasteLog(wl||[]); setItems(it||[]); setLoading(false)
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const suggestions = useMemo(() => {
    if (!query||query.length<2) return []
    const q=query.toLowerCase()
    return items.filter(i=>i.name.toLowerCase().includes(q)||i.part_number.toLowerCase().includes(q)).slice(0,8)
  }, [query, items])

  const selectItem = (item) => {
    setItemSel(item); setQuery(`${item.part_number} – ${item.name}`)
    setCost(item.unit_cost||''); setShowSug(false)
  }

  const handleLog = async () => {
    if (!itemSel) { toast.error('Select an item'); return }
    const q=Number(qty); if (!q||q<=0) { toast.error('Enter valid quantity'); return }
    setSaving(true)
    try {
      const newStock = Math.max(0, Number(itemSel.current_stock)-q)
      await supabase.from('items').update({ current_stock: newStock }).eq('id', itemSel.id)
      await supabase.from('stock_updates').insert({ item_id:itemSel.id, date, quantity_change:-q, new_quantity:newStock, updated_by:logBy||'System', note:`Waste – ${reason}` })
      const { data: w } = await supabase.from('waste_log')
        .insert({ item_id:itemSel.id, quantity:q, reason, date, logged_by:logBy||'System', notes, unit_cost:Number(cost)||0 })
        .select('*, items(name,part_number,unit,stores(name))').single()
      setWasteLog(prev=>[w,...prev])
      setItems(prev=>prev.map(i=>i.id===itemSel.id?{...i,current_stock:newStock}:i))
      toast.success(`Waste logged: ${q} ${itemSel.unit} of ${itemSel.name}`)
      setShowModal(false); setItemSel(null); setQuery(''); setQty(''); setNotes(''); setCost(''); setLogBy('')
    } catch(err) { toast.error(err.message) }
    setSaving(false)
  }

  const filtered = useMemo(() => {
    let list=[...wasteLog]
    if (search) { const q=search.toLowerCase(); list=list.filter(w=>w.items?.name?.toLowerCase().includes(q)||w.items?.part_number?.toLowerCase().includes(q)) }
    if (filterReason) list=list.filter(w=>w.reason===filterReason)
    return list
  }, [wasteLog, search, filterReason])

  const totalQty  = filtered.reduce((s,w)=>s+Number(w.quantity),0)
  const totalCost = filtered.reduce((s,w)=>s+Number(w.quantity)*Number(w.unit_cost||0),0)

  const chartData = REASONS.map(r=>({
    r, count:filtered.filter(w=>w.reason===r).length,
    cost:filtered.filter(w=>w.reason===r).reduce((s,w)=>s+Number(w.quantity)*Number(w.unit_cost||0),0),
  })).filter(d=>d.count>0)

  const exportCSV = () => {
    const h=['Date','Part #','Item','Store','Reason','Qty','Unit','Unit Cost','Total Cost','Logged By','Notes']
    const rows=filtered.map(w=>[w.date,w.items?.part_number,w.items?.name,w.items?.stores?.name,w.reason,w.quantity,w.items?.unit,w.unit_cost||0,(Number(w.quantity)*Number(w.unit_cost||0)).toFixed(2),w.logged_by||'',w.notes||''])
    const csv=[h,...rows].map(r=>r.map(v=>`"${v}"`).join(',')).join('\n')
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download=`waste_${dateFrom}_${dateTo}.csv`; a.click()
    toast.success('CSV exported')
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="page-title">Waste / Disposal Log</h1><p className="page-sub">Track discarded, expired and wasted items</p></div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={exportCSV} className="btn-secondary btn-sm"><Download className="w-4 h-4" /> CSV</button>
          <Button onClick={()=>{setShowModal(true);setDate(fmtDate(0))}}><Plus className="w-4 h-4" /> Log Waste</Button>
        </div>
      </div>

      {/* Filters */}
      <div className="card py-3 px-4 flex flex-wrap gap-3 items-center">
        <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} className="input text-sm w-auto" />
        <span className="text-slate-500 text-sm">→</span>
        <input type="date" value={dateTo}   onChange={e=>setDateTo(e.target.value)}   className="input text-sm w-auto" />
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className="input pl-9 text-sm" placeholder="Search item…" value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
        <select value={filterReason} onChange={e=>setFilterReason(e.target.value)} className="input text-sm w-auto">
          <option value="">All Reasons</option>
          {REASONS.map(r=><option key={r}>{r}</option>)}
        </select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card-sm text-center"><p className="text-2xl font-bold text-red-400">{filtered.length}</p><p className="text-slate-500 text-xs mt-1">Records</p></div>
        <div className="card-sm text-center"><p className="text-2xl font-bold text-orange-400">{totalQty.toFixed(1)}</p><p className="text-slate-500 text-xs mt-1">Units Wasted</p></div>
        <div className="card-sm text-center"><p className="text-2xl font-bold text-yellow-400">${totalCost.toFixed(2)}</p><p className="text-slate-500 text-xs mt-1">Estimated Value</p></div>
      </div>

      {/* Chart */}
      {chartData.length>0&&(
        <div className="card">
          <h2 className="font-display text-base font-semibold text-slate-100 mb-4">Waste by Reason</h2>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={chartData} margin={{top:0,right:20,left:0,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="r" tick={{fill:'#64748b',fontSize:11}} />
              <YAxis tick={{fill:'#64748b',fontSize:11}} />
              <Tooltip contentStyle={{background:'#1e293b',border:'1px solid #334155',borderRadius:'8px',color:'#f1f5f9',fontSize:'12px'}} />
              <Bar dataKey="count" name="Records" radius={[4,4,0,0]}>
                {chartData.map(d=><Cell key={d.r} fill={REASON_COLOR[d.r]||'#64748b'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length===0 ? (
        <div className="card text-center py-16 text-slate-500"><Trash2 className="w-12 h-12 mx-auto mb-3 opacity-20" /><p className="font-medium">No waste records</p><p className="text-sm mt-1">Click "Log Waste" to record a disposal.</p></div>
      ) : (
        <Table>
          <Thead><tr><Th>Date</Th><Th>Part #</Th><Th>Item Name</Th><Th>Store</Th><Th>Reason</Th><Th>Qty</Th><Th>Est. Cost</Th><Th>Logged By</Th><Th>Notes</Th></tr></Thead>
          <Tbody>
            {filtered.map(w=>(
              <Tr key={w.id}>
                <Td className="text-slate-400 text-xs whitespace-nowrap">{w.date}</Td>
                <Td className="font-mono text-xs text-slate-300">{w.items?.part_number}</Td>
                <Td className="font-medium text-slate-100 max-w-xs truncate">{w.items?.name}</Td>
                <Td className="text-slate-400 text-xs">{w.items?.stores?.name}</Td>
                <Td><Badge variant={REASON_BADGE[w.reason]||'gray'}>{w.reason}</Badge></Td>
                <Td className="text-red-400 font-semibold">{w.quantity} <span className="text-slate-500 text-xs font-normal">{w.items?.unit}</span></Td>
                <Td className="text-slate-300">${(Number(w.quantity)*Number(w.unit_cost||0)).toFixed(2)}</Td>
                <Td className="text-slate-400 text-xs">{w.logged_by||'—'}</Td>
                <Td className="text-slate-500 text-xs max-w-xs truncate">{w.notes||'—'}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {/* Modal */}
      <Modal isOpen={showModal} onClose={()=>setShowModal(false)} title="Log Waste / Disposal" size="sm"
        footer={<><Button variant="secondary" onClick={()=>setShowModal(false)}>Cancel</Button><Button variant="danger" onClick={handleLog} loading={saving}>Log Waste</Button></>}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Item *</label>
            <div className="relative">
              <input className="input" placeholder="Type part # or name…" value={query}
                onChange={e=>{setQuery(e.target.value);setItemSel(null);setShowSug(true)}}
                onFocus={()=>setShowSug(true)} onBlur={()=>setTimeout(()=>setShowSug(false),150)} />
              {showSug&&suggestions.length>0&&(
                <div className="absolute z-20 mt-1 w-full bg-slate-700 border border-slate-600 rounded-xl shadow-xl overflow-hidden">
                  {suggestions.map(i=>(
                    <button key={i.id} onMouseDown={()=>selectItem(i)} className="w-full text-left px-4 py-2.5 hover:bg-slate-600 text-sm">
                      <span className="font-mono text-teal-400 text-xs">{i.part_number}</span>
                      <span className="ml-2 text-slate-100">{i.name}</span>
                      <span className="ml-2 text-slate-400 text-xs">({i.current_stock} {i.unit})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {itemSel&&<div className="bg-slate-700/40 rounded-lg p-3 text-sm"><p className="font-medium text-slate-100">{itemSel.name}</p><p className="text-slate-400 text-xs">In stock: <strong className="text-teal-400">{itemSel.current_stock} {itemSel.unit}</strong></p></div>}
          <Select label="Reason *" value={reason} onChange={e=>setReason(e.target.value)}>
            {REASONS.map(r=><option key={r}>{r}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label={`Quantity${itemSel?` (${itemSel.unit})`:''} *`} type="number" min="0.01" step="0.01" value={qty} onChange={e=>setQty(e.target.value)} />
            <Input label="Unit Cost ($)" type="number" min="0" step="0.01" value={cost} onChange={e=>setCost(e.target.value)} />
          </div>
          <Input label="Date" type="date" value={date} onChange={e=>setDate(e.target.value)} />
          <Input label="Logged By" value={logBy} onChange={e=>setLogBy(e.target.value)} placeholder="Your name" />
          <Input label="Notes (optional)" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Additional details…" />
          {qty&&cost&&Number(qty)>0&&Number(cost)>0&&(
            <div className="bg-red-900/30 border border-red-700/40 rounded-lg p-3 text-sm text-red-300">
              Estimated waste value: <strong>${(Number(qty)*Number(cost)).toFixed(2)}</strong>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
