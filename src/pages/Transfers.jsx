import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { ArrowLeftRight, Plus, Download, Search, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import Input, { Select } from '../components/ui/Input'

const fmtDate = (n=0) => { const d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().split('T')[0] }

export default function Transfers() {
  const [transfers, setTransfers] = useState([])
  const [items,     setItems]     = useState([])
  const [stores,    setStores]    = useState([])
  const [loading,   setLoading]   = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [search,    setSearch]    = useState('')
  const [dateFrom,  setDateFrom]  = useState(fmtDate(30))
  const [dateTo,    setDateTo]    = useState(fmtDate(0))
  // form
  const [fromStore, setFromStore] = useState('')
  const [toStore,   setToStore]   = useState('')
  const [query,     setQuery]     = useState('')
  const [itemSel,   setItemSel]   = useState(null)
  const [qty,       setQty]       = useState('')
  const [date,      setDate]      = useState(fmtDate(0))
  const [reason,    setReason]    = useState('')
  const [transferBy,setTransferBy]= useState('')
  const [showSug,   setShowSug]   = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: tr }, { data: it }, { data: st }] = await Promise.all([
      supabase.from('transfers')
        .select('*, items(name,part_number,unit), from_store:stores!transfers_from_store_id_fkey(name), to_store:stores!transfers_to_store_id_fkey(name)')
        .gte('date', dateFrom).lte('date', dateTo)
        .order('date', { ascending:false }).order('created_at', { ascending:false }),
      supabase.from('items').select('id,name,part_number,unit,current_stock,store_id,stores(name)').order('name'),
      supabase.from('stores').select('*').order('name'),
    ])
    setTransfers(tr||[]); setItems(it||[]); setStores(st||[]); setLoading(false)
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const suggestions = useMemo(() => {
    if (!query||query.length<2) return []
    const q=query.toLowerCase()
    return items.filter(i=>i.name.toLowerCase().includes(q)||i.part_number.toLowerCase().includes(q)).slice(0,8)
  }, [query, items])

  const selectItem = (item) => {
    setItemSel(item); setQuery(`${item.part_number} – ${item.name}`)
    if (!fromStore && item.store_id) setFromStore(item.store_id)
    setShowSug(false)
  }

  const handleTransfer = async () => {
    if (!itemSel) { toast.error('Select an item'); return }
    if (!fromStore) { toast.error('Select source store'); return }
    if (!toStore)   { toast.error('Select destination store'); return }
    if (fromStore === toStore) { toast.error('Source and destination must differ'); return }
    const q=Number(qty); if (!q||q<=0) { toast.error('Enter valid quantity'); return }
    if (q > Number(itemSel.current_stock)) { toast.error(`Only ${itemSel.current_stock} ${itemSel.unit} available`); return }
    setSaving(true)
    try {
      const newStock = Number(itemSel.current_stock)-q
      await supabase.from('items').update({ current_stock: newStock }).eq('id', itemSel.id)
      await supabase.from('stock_updates').insert({ item_id:itemSel.id, date, quantity_change:-q, new_quantity:newStock, updated_by:transferBy||'System', note:`Transfer → ${stores.find(s=>s.id===toStore)?.name}` })
      await supabase.from('transfers').insert({ from_store_id:fromStore, to_store_id:toStore, item_id:itemSel.id, quantity:q, date, reason, transferred_by:transferBy||'System' })
      toast.success(`Transferred ${q} ${itemSel.unit} of ${itemSel.name}`)
      setShowModal(false); setItemSel(null); setQuery(''); setQty(''); setReason(''); setTransferBy('')
      load()
    } catch(err) { toast.error(err.message) }
    setSaving(false)
  }

  const filtered = useMemo(() => {
    if (!search) return transfers
    const q=search.toLowerCase()
    return transfers.filter(t=>t.items?.name?.toLowerCase().includes(q)||t.items?.part_number?.toLowerCase().includes(q))
  }, [transfers, search])

  const exportCSV = () => {
    const h=['Date','Part #','Item','From','To','Qty','Unit','Transferred By','Reason']
    const rows=filtered.map(t=>[t.date,t.items?.part_number,t.items?.name,t.from_store?.name,t.to_store?.name,t.quantity,t.items?.unit,t.transferred_by||'',t.reason||''])
    const csv=[h,...rows].map(r=>r.map(v=>`"${v}"`).join(',')).join('\n')
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download=`transfers_${dateFrom}_${dateTo}.csv`; a.click()
    toast.success('CSV exported')
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="page-title">Store Transfers</h1><p className="page-sub">Move stock between stores without recording as a loss</p></div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={exportCSV} className="btn-secondary btn-sm"><Download className="w-4 h-4" /> CSV</button>
          <Button onClick={()=>{setShowModal(true);setDate(fmtDate(0))}}><Plus className="w-4 h-4" /> New Transfer</Button>
        </div>
      </div>

      <div className="card py-3 px-4 flex flex-wrap gap-3 items-center">
        <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} className="input text-sm w-auto" />
        <span className="text-slate-500 text-sm">→</span>
        <input type="date" value={dateTo}   onChange={e=>setDateTo(e.target.value)}   className="input text-sm w-auto" />
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className="input pl-9 text-sm" placeholder="Search item…" value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
        <span className="text-slate-400 text-sm">{filtered.length} records</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card-sm text-center"><p className="text-2xl font-bold text-teal-400">{filtered.length}</p><p className="text-slate-500 text-xs mt-1">Transfers</p></div>
        <div className="card-sm text-center"><p className="text-2xl font-bold text-blue-400">{filtered.reduce((s,t)=>s+Number(t.quantity),0).toFixed(1)}</p><p className="text-slate-500 text-xs mt-1">Total Units Moved</p></div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length===0 ? (
        <div className="card text-center py-16 text-slate-500"><ArrowLeftRight className="w-12 h-12 mx-auto mb-3 opacity-20" /><p className="font-medium">No transfers recorded</p><p className="text-sm mt-1">Record a transfer when moving items between stores.</p></div>
      ) : (
        <Table>
          <Thead><tr><Th>Date</Th><Th>Part #</Th><Th>Item</Th><Th>From</Th><Th>To</Th><Th>Qty</Th><Th>By</Th><Th>Reason</Th></tr></Thead>
          <Tbody>
            {filtered.map(t=>(
              <Tr key={t.id}>
                <Td className="text-slate-400 text-xs whitespace-nowrap">{t.date}</Td>
                <Td className="font-mono text-xs text-slate-300">{t.items?.part_number}</Td>
                <Td className="font-medium text-slate-100 max-w-xs truncate">{t.items?.name}</Td>
                <Td className="text-slate-400 text-xs">{t.from_store?.name}</Td>
                <Td className="text-teal-400 text-xs font-medium">{t.to_store?.name}</Td>
                <Td className="text-slate-100 font-semibold">{t.quantity} <span className="text-slate-500 text-xs font-normal">{t.items?.unit}</span></Td>
                <Td className="text-slate-400 text-xs">{t.transferred_by||'—'}</Td>
                <Td className="text-slate-500 text-xs max-w-xs truncate">{t.reason||'—'}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      <Modal isOpen={showModal} onClose={()=>setShowModal(false)} title="New Store Transfer" size="sm"
        footer={<><Button variant="secondary" onClick={()=>setShowModal(false)}>Cancel</Button><Button onClick={handleTransfer} loading={saving}>Transfer Stock</Button></>}>
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
                      <span className="ml-2 text-slate-400 text-xs">{i.stores?.name} · {i.current_stock} {i.unit}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {itemSel&&<div className="bg-teal-900/20 border border-teal-700/30 rounded-lg p-3 text-sm"><p className="font-medium text-slate-100">{itemSel.name}</p><p className="text-slate-400 text-xs">Currently in: <strong className="text-teal-400">{itemSel.stores?.name}</strong> · {itemSel.current_stock} {itemSel.unit} available</p></div>}
          <Select label="From Store *" value={fromStore} onChange={e=>setFromStore(e.target.value)}>
            <option value="">Select source store…</option>
            {stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select label="To Store *" value={toStore} onChange={e=>setToStore(e.target.value)}>
            <option value="">Select destination store…</option>
            {stores.filter(s=>s.id!==fromStore).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label={`Quantity${itemSel?` (${itemSel.unit})`:''} *`} type="number" min="0.01" step="0.01" value={qty} onChange={e=>setQty(e.target.value)} />
            <Input label="Date" type="date" value={date} onChange={e=>setDate(e.target.value)} />
          </div>
          <Input label="Transferred By" value={transferBy} onChange={e=>setTransferBy(e.target.value)} placeholder="Your name" />
          <Input label="Reason (optional)" value={reason} onChange={e=>setReason(e.target.value)} placeholder="e.g. Bar is full, storing excess" />
        </div>
      </Modal>
    </div>
  )
}
