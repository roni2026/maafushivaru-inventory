import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { ClipboardCheck, Plus, CheckCircle, XCircle, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import Input, { Select } from '../components/ui/Input'

const fmtDate = () => new Date().toISOString().split('T')[0]

export default function Stocktake() {
  const [stocktakes, setStocktakes] = useState([])
  const [stores,     setStores]     = useState([])
  const [loading,    setLoading]    = useState(true)
  const [active,     setActive]     = useState(null) // current in-progress stocktake
  const [showNew,    setShowNew]    = useState(false)
  const [saving,     setSaving]     = useState(false)
  // new stocktake form
  const [newStore,   setNewStore]   = useState('')
  const [newBy,      setNewBy]      = useState('')
  const [newNotes,   setNewNotes]   = useState('')
  // active stocktake items
  const [stItems,    setStItems]    = useState([]) // stocktake_items with item data
  const [counts,     setCounts]     = useState({}) // { stocktake_item_id: actual_qty }
  const [applying,   setApplying]   = useState(false)
  const [expanded,   setExpanded]   = useState(null) // history row expanded

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: st }, { data: sv }] = await Promise.all([
      supabase.from('stores').select('*').order('name'),
      supabase.from('stocktakes').select('*, stores(name)').order('started_at', { ascending:false }).limit(20),
    ])
    setStores(st||[])
    setStocktakes(sv||[])
    const inProg = (sv||[]).find(s=>s.status==='in_progress')
    if (inProg) loadActive(inProg)
    else setLoading(false)
  }, [])

  const loadActive = async (take) => {
    const { data: si } = await supabase.from('stocktake_items')
      .select('*, items(id,name,part_number,unit,current_stock)')
      .eq('stocktake_id', take.id).order('created_at')
    setActive(take)
    setStItems(si||[])
    const init = {}; (si||[]).forEach(i=>{ init[i.id]=i.actual_qty===null?'':String(i.actual_qty) })
    setCounts(init)
    setLoading(false)
  }

  useEffect(() => { load() }, [load])

  const startNew = async () => {
    if (!newBy.trim()) { toast.error('Enter your name'); return }
    setSaving(true)
    try {
      // Get items from the selected store (or all stores)
      const query = supabase.from('items').select('id,name,part_number,unit,current_stock').order('name')
      if (newStore) query.eq('store_id', newStore)
      const { data: items } = await query
      if (!items?.length) { toast.error('No items found for that store'); setSaving(false); return }

      const { data: take } = await supabase.from('stocktakes')
        .insert({ store_id:newStore||null, started_by:newBy, notes:newNotes, status:'in_progress' })
        .select('*, stores(name)').single()
      const siRows = items.map(i=>({ stocktake_id:take.id, item_id:i.id, expected_qty:Number(i.current_stock) }))
      const { data: si } = await supabase.from('stocktake_items').insert(siRows).select('*, items(id,name,part_number,unit,current_stock)')
      setActive(take)
      setStocktakes(prev=>[take,...prev])
      setStItems(si||[])
      const init={}; (si||[]).forEach(i=>{ init[i.id]='' })
      setCounts(init)
      setShowNew(false); setNewBy(''); setNewNotes(''); setNewStore('')
      toast.success(`Stocktake started for ${take.stores?.name||'all stores'} (${(si||[]).length} items)`)
    } catch(err) { toast.error(err.message) }
    setSaving(false)
  }

  const applyAdjustments = async () => {
    if (!active) return
    const toUpdate = stItems.filter(i=>counts[i.id]!==''&&counts[i.id]!==null&&Number(counts[i.id])!==Number(i.expected_qty))
    if (!toUpdate.length) { toast.error('No differences found — nothing to adjust'); return }
    if (!confirm(`Apply ${toUpdate.length} stock adjustment(s)? This will update stock levels.`)) return
    setApplying(true)
    try {
      for (const si of toUpdate) {
        const actual=Number(counts[si.id]); const diff=actual-Number(si.expected_qty)
        await supabase.from('items').update({ current_stock:actual }).eq('id', si.items.id)
        await supabase.from('stock_updates').insert({ item_id:si.items.id, date:fmtDate(), quantity_change:diff, new_quantity:actual, updated_by:active.started_by||'Stocktake', note:`Stocktake adjustment` })
        await supabase.from('stocktake_items').update({ actual_qty:actual }).eq('id', si.id)
      }
      await supabase.from('stocktakes').update({ status:'completed', completed_at:new Date().toISOString() }).eq('id', active.id)
      toast.success(`Applied ${toUpdate.length} adjustments. Stocktake complete!`)
      setActive(null); setStItems([]); setCounts({})
      load()
    } catch(err) { toast.error(err.message) }
    setApplying(false)
  }

  const cancelStocktake = async () => {
    if (!active) return
    if (!confirm('Cancel this stocktake? No adjustments will be made.')) return
    await supabase.from('stocktakes').update({ status:'cancelled' }).eq('id', active.id)
    setActive(null); setStItems([]); setCounts({})
    load()
    toast('Stocktake cancelled', { icon:'⚠️' })
  }

  // Discrepancy summary
  const discrepancies = useMemo(() =>
    stItems.filter(i=>counts[i.id]!==''&&Number(counts[i.id])!==Number(i.expected_qty)),
  [stItems, counts])

  const filled = Object.values(counts).filter(v=>v!=='').length
  const pct = stItems.length>0 ? Math.round((filled/stItems.length)*100) : 0

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="page-title">Physical Stocktake</h1><p className="page-sub">Compare actual shelf count vs system quantities</p></div>
        {!active && <Button onClick={()=>setShowNew(true)}><Plus className="w-4 h-4" /> Start Stocktake</Button>}
      </div>

      {/* Active stocktake */}
      {active && (
        <div className="space-y-4">
          {/* Header banner */}
          <div className="card border border-teal-700/40 bg-teal-900/10">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="font-semibold text-teal-300 text-base">Active Stocktake</p>
                <p className="text-slate-400 text-sm mt-0.5">
                  {active.stores?.name||'All Stores'} · Started by {active.started_by} · {new Date(active.started_at).toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={cancelStocktake}>Cancel Stocktake</Button>
                <Button onClick={applyAdjustments} loading={applying} disabled={discrepancies.length===0}>
                  Apply {discrepancies.length} Adjustment{discrepancies.length!==1?'s':''}
                </Button>
              </div>
            </div>
            {/* Progress */}
            <div className="mt-4">
              <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                <span>Progress: {filled}/{stItems.length} items counted</span>
                <span>{pct}%</span>
              </div>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-teal-500 rounded-full transition-all duration-300" style={{width:`${pct}%`}} />
              </div>
            </div>
          </div>

          {/* Discrepancy summary */}
          {discrepancies.length>0&&(
            <div className="card border border-orange-700/40 bg-orange-900/10">
              <p className="font-semibold text-orange-300 mb-3">⚠ {discrepancies.length} Discrepancy{discrepancies.length!==1?'s':''} Found</p>
              <div className="space-y-2">
                {discrepancies.slice(0,5).map(si=>{
                  const actual=Number(counts[si.id]); const diff=actual-Number(si.expected_qty)
                  return (
                    <div key={si.id} className="flex items-center justify-between text-sm">
                      <span className="text-slate-200 truncate max-w-xs">{si.items?.name}</span>
                      <span className={`font-semibold shrink-0 ml-3 ${diff>0?'text-green-400':'text-red-400'}`}>
                        {diff>0?'+':''}{diff} {si.items?.unit}
                      </span>
                    </div>
                  )
                })}
                {discrepancies.length>5&&<p className="text-slate-500 text-xs">...and {discrepancies.length-5} more</p>}
              </div>
            </div>
          )}

          {/* Count grid */}
          <div className="card">
            <p className="font-display text-base font-semibold text-slate-100 mb-4">Enter Physical Counts</p>
            <div className="space-y-2">
              {stItems.map(si=>{
                const val=counts[si.id]
                const hasCount=val!==''
                const diff=hasCount?Number(val)-Number(si.expected_qty):null
                const isMatch=diff===0
                return (
                  <div key={si.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${hasCount&&!isMatch?'border-orange-700/40 bg-orange-900/10':hasCount&&isMatch?'border-green-700/30 bg-green-900/10':'border-slate-700/30 bg-slate-700/10'}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-100 truncate">{si.items?.name}</p>
                      <p className="text-xs text-slate-500">{si.items?.part_number} · System: {si.expected_qty} {si.items?.unit}</p>
                    </div>
                    <input
                      type="number" min="0" step="0.01" placeholder="Actual count"
                      value={val}
                      onChange={e=>setCounts(p=>({...p,[si.id]:e.target.value}))}
                      className={`input w-32 text-sm text-right ${hasCount&&!isMatch?'border-orange-600':''}` }
                    />
                    <div className="w-20 text-right shrink-0">
                      {hasCount&&isMatch&&<CheckCircle className="w-5 h-5 text-green-400 ml-auto" />}
                      {hasCount&&!isMatch&&<span className={`text-sm font-bold ${diff>0?'text-green-400':'text-red-400'}`}>{diff>0?'+':''}{diff}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* No active stocktake */}
      {!active && !loading && (
        <div className="card text-center py-16 text-slate-500">
          <ClipboardCheck className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="font-medium">No active stocktake</p>
          <p className="text-sm mt-1">Start a new stocktake to count your shelves.</p>
        </div>
      )}

      {/* History */}
      {stocktakes.filter(s=>s.status!=='in_progress').length>0&&(
        <div className="card">
          <p className="font-display text-base font-semibold text-slate-100 mb-4">Stocktake History</p>
          <div className="space-y-2">
            {stocktakes.filter(s=>s.status!=='in_progress').map(s=>(
              <div key={s.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-700/20 border border-slate-700/30">
                <div>
                  <p className="text-sm font-medium text-slate-200">{s.stores?.name||'All Stores'}</p>
                  <p className="text-xs text-slate-500">By {s.started_by} · {new Date(s.started_at).toLocaleDateString()}</p>
                </div>
                <Badge variant={s.status==='completed'?'green':s.status==='cancelled'?'red':'teal'}>
                  {s.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New stocktake modal */}
      <Modal isOpen={showNew} onClose={()=>setShowNew(false)} title="Start New Stocktake" size="sm"
        footer={<><Button variant="secondary" onClick={()=>setShowNew(false)}>Cancel</Button><Button onClick={startNew} loading={saving}>Start Stocktake</Button></>}>
        <div className="space-y-4">
          <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-3 text-sm text-blue-300">
            <strong>How it works:</strong> The system will load all items with their current stock as the expected quantity. Walk the shelves and enter what you actually see. Apply to correct any differences.
          </div>
          <Select label="Store (optional — leave blank for all)" value={newStore} onChange={e=>setNewStore(e.target.value)}>
            <option value="">All Stores</option>
            {stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Input label="Started By *" value={newBy} onChange={e=>setNewBy(e.target.value)} placeholder="Your name" />
          <Input label="Notes (optional)" value={newNotes} onChange={e=>setNewNotes(e.target.value)} placeholder="e.g. Monthly stocktake June 2026" />
        </div>
      </Modal>
    </div>
  )
}
