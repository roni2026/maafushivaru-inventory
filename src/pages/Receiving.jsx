import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Inbox, Plus, Trash2, ChevronDown, ChevronRight, Download, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Input, { Select } from '../components/ui/Input'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'

const fmtDate = (n=0) => { const d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().split('T')[0] }

const EMPTY_LINE = () => ({ id:Math.random().toString(36).slice(2), query:'', itemSel:null, qty:'', unitCost:'', showSug:false })

export default function Receiving() {
  const [tab,       setTab]       = useState('new') // 'new' | 'history'
  const [items,     setItems]     = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [history,   setHistory]   = useState([])
  const [loading,   setLoading]   = useState(false)
  const [histLoading,setHistLoading]=useState(false)
  const [saving,    setSaving]    = useState(false)
  const [expanded,  setExpanded]  = useState(null)
  const [expandedItems,setExpandedItems]=useState({}) // grn_id -> items
  // form
  const [supplierName,setSupplierName]=useState('')
  const [receivedBy,  setReceivedBy]  =useState('')
  const [date,        setDate]        =useState(fmtDate(0))
  const [invoice,     setInvoice]     =useState('')
  const [notes,       setNotes]       =useState('')
  const [lines,       setLines]       =useState([EMPTY_LINE()])

  const loadBase = useCallback(async () => {
    setLoading(true)
    const [{ data: it }, { data: sv }] = await Promise.all([
      supabase.from('items').select('id,name,part_number,unit,current_stock,unit_cost').order('name'),
      supabase.from('suppliers').select('*').order('name'),
    ])
    setItems(it||[])
    setSuppliers(sv||[])
    setLoading(false)
  }, [])

  const loadHistory = useCallback(async () => {
    setHistLoading(true)
    const { data } = await supabase.from('receiving_log')
      .select('*').order('date',{ascending:false}).order('created_at',{ascending:false}).limit(50)
    setHistory(data||[])
    setHistLoading(false)
  }, [])

  useEffect(() => { loadBase() }, [loadBase])
  useEffect(() => { if (tab==='history') loadHistory() }, [tab, loadHistory])

  const getSuggestions = (query) => {
    if (!query||query.length<2) return []
    const q=query.toLowerCase()
    return items.filter(i=>i.name.toLowerCase().includes(q)||i.part_number.toLowerCase().includes(q)).slice(0,8)
  }

  const setLine = (id, patch) => setLines(prev=>prev.map(l=>l.id===id?{...l,...patch}:l))
  const addLine  = () => setLines(prev=>[...prev,EMPTY_LINE()])
  const removeLine = (id) => setLines(prev=>prev.filter(l=>l.id!==id))
  const selectItem = (lineId, item) => {
    setLine(lineId,{itemSel:item,query:`${item.part_number} – ${item.name}`,showSug:false,unitCost:item.unit_cost||''})
  }

  const totalValue = lines.reduce((s,l)=>s+(Number(l.qty)||0)*(Number(l.unitCost)||0),0)
  const validLines = lines.filter(l=>l.itemSel&&Number(l.qty)>0)

  const handleReceive = async () => {
    if (!receivedBy.trim()) { toast.error('Enter received by name'); return }
    if (validLines.length===0) { toast.error('Add at least one item with quantity'); return }
    setSaving(true)
    try {
      const { data: grn } = await supabase.from('receiving_log')
        .insert({ supplier_name:supplierName||'Unknown', received_by:receivedBy, date, invoice_number:invoice, notes, total_value:totalValue })
        .select().single()
      for (const line of validLines) {
        const q=Number(line.qty); const cost=Number(line.unitCost)||0
        const newStock=Number(line.itemSel.current_stock)+q
        await supabase.from('receiving_items').insert({ receiving_id:grn.id, item_id:line.itemSel.id, quantity:q, unit_cost:cost })
        await supabase.from('items').update({ current_stock:newStock, unit_cost:cost||line.itemSel.unit_cost }).eq('id',line.itemSel.id)
        await supabase.from('stock_updates').insert({ item_id:line.itemSel.id, date, quantity_change:q, new_quantity:newStock, updated_by:receivedBy, note:`GRN – ${supplierName||'Receiving'}${invoice?` (Inv: ${invoice})`:''}`  })
      }
      toast.success(`GRN recorded — ${validLines.length} items, $${totalValue.toFixed(2)} total value`)
      setSupplierName(''); setReceivedBy(''); setInvoice(''); setNotes('')
      setLines([EMPTY_LINE()]); loadBase()
    } catch(err) { toast.error(err.message) }
    setSaving(false)
  }

  const loadExpandedItems = async (id) => {
    if (expandedItems[id]) { setExpanded(expanded===id?null:id); return }
    const { data } = await supabase.from('receiving_items')
      .select('*, items(name,part_number,unit)').eq('receiving_id',id)
    setExpandedItems(p=>({...p,[id]:data||[]}))
    setExpanded(id)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="page-title">Receiving / GRN</h1><p className="page-sub">Record incoming stock deliveries and update inventory</p></div>
        <button onClick={()=>setTab(t=>t==='new'?'history':'new')} className="btn-secondary btn-sm">
          {tab==='new'?'View History':'New Delivery'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-700">
        {[{key:'new',label:'New Delivery'},{key:'history',label:'GRN History'}].map(({key,label})=>(
          <button key={key} onClick={()=>setTab(key)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${tab===key?'border-teal-500 text-teal-400':'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab==='new'&&(
        <div className="space-y-5">
          {/* Header info */}
          <div className="card">
            <p className="font-display text-base font-semibold text-slate-100 mb-4">Delivery Information</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Supplier</label>
                <input className="input" list="supplier-list" value={supplierName} onChange={e=>setSupplierName(e.target.value)} placeholder="Supplier name…" />
                <datalist id="supplier-list">{suppliers.map(s=><option key={s.id} value={s.name}/>)}</datalist>
              </div>
              <Input label="Received By *" value={receivedBy} onChange={e=>setReceivedBy(e.target.value)} placeholder="Your name" />
              <Input label="Date" type="date" value={date} onChange={e=>setDate(e.target.value)} />
              <Input label="Invoice / DO Number" value={invoice} onChange={e=>setInvoice(e.target.value)} placeholder="e.g. INV-2026-001" />
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-slate-300 mb-1">Notes</label>
              <input className="input" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional delivery notes…" />
            </div>
          </div>

          {/* Line items */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <p className="font-display text-base font-semibold text-slate-100">Items Received</p>
              <button onClick={addLine} className="btn-ghost btn-sm"><Plus className="w-4 h-4" /> Add Item</button>
            </div>
            <div className="space-y-3">
              {lines.map((line,idx)=>(
                <div key={line.id} className="p-3 bg-slate-700/20 rounded-xl border border-slate-700/30 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 w-5 shrink-0">{idx+1}.</span>
                    <div className="relative flex-1">
                      <input className="input text-sm" placeholder="Type item name or part #…" value={line.query}
                        onChange={e=>setLine(line.id,{query:e.target.value,itemSel:null,showSug:true})}
                        onFocus={()=>setLine(line.id,{showSug:true})}
                        onBlur={()=>setTimeout(()=>setLine(line.id,{showSug:false}),150)} />
                      {line.showSug&&getSuggestions(line.query).length>0&&(
                        <div className="absolute z-20 mt-1 w-full bg-slate-700 border border-slate-600 rounded-xl shadow-xl overflow-hidden">
                          {getSuggestions(line.query).map(i=>(
                            <button key={i.id} onMouseDown={()=>selectItem(line.id,i)} className="w-full text-left px-4 py-2.5 hover:bg-slate-600 text-sm">
                              <span className="font-mono text-teal-400 text-xs">{i.part_number}</span>
                              <span className="ml-2 text-slate-100">{i.name}</span>
                              <span className="ml-2 text-slate-400 text-xs">({i.current_stock} {i.unit})</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {lines.length>1&&<button onClick={()=>removeLine(line.id)} className="p-1.5 text-slate-500 hover:text-red-400 transition-colors shrink-0"><Trash2 className="w-4 h-4"/></button>}
                  </div>
                  {line.itemSel&&(
                    <div className="flex gap-3 pl-7">
                      <div className="flex-1">
                        <label className="text-xs text-slate-400 mb-0.5 block">Qty Received ({line.itemSel.unit})</label>
                        <input type="number" min="0.01" step="0.01" className="input text-sm" value={line.qty} onChange={e=>setLine(line.id,{qty:e.target.value})} placeholder="0" />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-slate-400 mb-0.5 block">Unit Cost ($)</label>
                        <input type="number" min="0" step="0.01" className="input text-sm" value={line.unitCost} onChange={e=>setLine(line.id,{unitCost:e.target.value})} placeholder="0.00" />
                      </div>
                      <div className="flex-1 flex flex-col justify-end">
                        <p className="text-xs text-slate-400 mb-1">Line Total</p>
                        <p className="text-sm font-semibold text-teal-400">${((Number(line.qty)||0)*(Number(line.unitCost)||0)).toFixed(2)}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 pt-4 border-t border-slate-700 flex items-center justify-between">
              <div className="text-sm">
                <span className="text-slate-400">Total Value: </span>
                <span className="text-xl font-bold text-teal-400">${totalValue.toFixed(2)}</span>
                <span className="text-slate-500 ml-2 text-xs">({validLines.length} valid item{validLines.length!==1?'s':''})</span>
              </div>
              <Button onClick={handleReceive} loading={saving} disabled={validLines.length===0}>
                Confirm & Update Stock
              </Button>
            </div>
          </div>
        </div>
      )}

      {tab==='history'&&(
        <div className="space-y-3">
          {histLoading ? (
            <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : history.length===0 ? (
            <div className="card text-center py-16 text-slate-500"><Inbox className="w-12 h-12 mx-auto mb-3 opacity-20" /><p className="font-medium">No deliveries recorded yet</p></div>
          ) : (
            history.map(grn=>(
              <div key={grn.id} className="card border border-slate-700/40">
                <button className="w-full flex items-center justify-between text-left" onClick={()=>loadExpandedItems(grn.id)}>
                  <div>
                    <p className="font-semibold text-slate-100">{grn.supplier_name||'Unknown Supplier'}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{grn.date} · Received by {grn.received_by||'—'}{grn.invoice_number?` · Inv: ${grn.invoice_number}`:''}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <span className="text-sm font-bold text-teal-400">${Number(grn.total_value).toFixed(2)}</span>
                    {expanded===grn.id?<ChevronDown className="w-4 h-4 text-slate-400"/>:<ChevronRight className="w-4 h-4 text-slate-400"/>}
                  </div>
                </button>
                {expanded===grn.id&&expandedItems[grn.id]&&(
                  <div className="mt-3 pt-3 border-t border-slate-700/40">
                    {grn.notes&&<p className="text-xs text-slate-500 mb-3 italic">{grn.notes}</p>}
                    <Table>
                      <Thead><tr><Th>Part #</Th><Th>Item</Th><Th>Qty Received</Th><Th>Unit Cost</Th><Th>Line Total</Th></tr></Thead>
                      <Tbody>
                        {expandedItems[grn.id].map(ri=>(
                          <Tr key={ri.id}>
                            <Td className="font-mono text-xs text-slate-300">{ri.items?.part_number}</Td>
                            <Td className="font-medium text-slate-100 max-w-xs truncate">{ri.items?.name}</Td>
                            <Td className="text-teal-400 font-semibold">{ri.quantity} <span className="text-slate-500 text-xs font-normal">{ri.items?.unit}</span></Td>
                            <Td className="text-slate-300">${Number(ri.unit_cost||0).toFixed(2)}</Td>
                            <Td className="text-slate-300 font-semibold">${(Number(ri.quantity)*Number(ri.unit_cost||0)).toFixed(2)}</Td>
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
