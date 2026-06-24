import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSort } from '../hooks/useSort'
import { supabase } from '../lib/supabase'
import { History, Search, Download, RefreshCw, ArrowUp, ArrowDown, Filter } from 'lucide-react'
import toast from 'react-hot-toast'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'

// ── Date helpers ───────────────────────────────────────────
const fmtDate = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

export default function StockHistory() {
  const [records,     setRecords]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')
  const [typeFilter,  setTypeFilter]  = useState('') // '' | 'in' | 'out' | 'issuance' | 'manual'
  const [dateFrom,    setDateFrom]    = useState(fmtDate(30))
  const [dateTo,      setDateTo]      = useState(fmtDate(0))
  const [sortDir,     setSortDir]     = useState('desc')
  const [stores,      setStores]      = useState([])
  const [storeFilter, setStoreFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: recs, error }, { data: st }] = await Promise.all([
      supabase
        .from('stock_updates')
        .select('*, items(id, name, part_number, unit, store_id, stores(name, category))')
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .order('created_at', { ascending: sortDir === 'asc' })
        .limit(1000),
      supabase.from('stores').select('*').order('name'),
    ])
    if (error) { toast.error('Failed to load history'); setLoading(false); return }
    setRecords(recs || [])
    setStores(st || [])
    setLoading(false)
  }, [dateFrom, dateTo, sortDir])

  useEffect(() => { load() }, [load])

  // ── Quick date range buttons ───────────────────────────
  const setRange = (days) => {
    setDateFrom(fmtDate(days))
    setDateTo(fmtDate(0))
  }

  // ── Filter ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...records]
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        r.items?.name?.toLowerCase().includes(q) ||
        r.items?.part_number?.toLowerCase().includes(q) ||
        (r.note || '').toLowerCase().includes(q) ||
        (r.updated_by || '').toLowerCase().includes(q)
      )
    }
    if (storeFilter) list = list.filter(r => r.items?.store_id === storeFilter)
    if (typeFilter === 'in')       list = list.filter(r => r.quantity_change > 0)
    if (typeFilter === 'out')      list = list.filter(r => r.quantity_change < 0)
    if (typeFilter === 'issuance') list = list.filter(r => (r.note||'').toLowerCase().includes('issuance'))
    if (typeFilter === 'manual')   list = list.filter(r => !(r.note||'').toLowerCase().includes('issuance'))
    return list
  }, [records, search, storeFilter, typeFilter])

  const { sorted, thProps } = useSort(filtered, 'date', 'desc')

  // ── CSV export ─────────────────────────────────────────
  const exportCSV = () => {
    const headers = ['Date','Part #','Item Name','Store','Change','New Qty','Unit','Updated By','Note']
    const rows = filtered.map(r => [
      r.date,
      r.items?.part_number || '',
      r.items?.name || '',
      r.items?.stores?.name || '',
      r.quantity_change,
      r.new_quantity,
      r.items?.unit || '',
      r.updated_by || '',
      (r.note || '').replace(/"/g, "'"),
    ])
    const csv = [headers, ...rows].map(row => row.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `stock_history_${dateFrom}_to_${dateTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${filtered.length} records to CSV`)
  }

  // ── Summary stats ──────────────────────────────────────
  const totalIn  = filtered.filter(r=>r.quantity_change>0).reduce((s,r)=>s+Number(r.quantity_change),0)
  const totalOut = Math.abs(filtered.filter(r=>r.quantity_change<0).reduce((s,r)=>s+Number(r.quantity_change),0))
  const issuanceCount = filtered.filter(r=>(r.note||'').toLowerCase().includes('issuance')).length

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Stock History</h1>
          <p className="page-sub">Complete audit trail of every stock movement</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-ghost btn-sm" title="Reload">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={exportCSV} className="btn-secondary btn-sm">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
      </div>

      {/* Quick date range */}
      <div className="flex gap-2 flex-wrap">
        {[{label:'Today',days:0},{label:'Last 7 days',days:7},{label:'Last 14 days',days:14},{label:'Last 30 days',days:30},{label:'Last 90 days',days:90}].map(({label,days}) => (
          <button key={label} onClick={() => setRange(days)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${dateFrom===fmtDate(days)&&dateTo===fmtDate(0) ? 'bg-teal-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="card py-3 px-4 flex flex-wrap gap-3 items-center">
        <Filter className="w-4 h-4 text-slate-400 shrink-0" />
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            placeholder="Search item, part #, user, note…"
            value={search} onChange={e=>setSearch(e.target.value)}
            className="input pl-9 text-sm" />
        </div>
        <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} className="input text-sm w-auto" />
        <span className="text-slate-500 text-sm">→</span>
        <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} className="input text-sm w-auto" />
        <select value={storeFilter} onChange={e=>setStoreFilter(e.target.value)} className="input text-sm w-auto">
          <option value="">All Stores</option>
          {stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} className="input text-sm w-auto">
          <option value="">All Types</option>
          <option value="in">Stock In (+)</option>
          <option value="out">Stock Out (−)</option>
          <option value="issuance">Issuances only</option>
          <option value="manual">Manual updates only</option>
        </select>
        <select value={sortDir} onChange={e=>setSortDir(e.target.value)} className="input text-sm w-auto">
          <option value="desc">Newest first</option>
          <option value="asc">Oldest first</option>
        </select>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card-sm text-center">
          <p className="text-xl font-bold text-slate-100">{filtered.length}</p>
          <p className="text-slate-500 text-xs mt-0.5">Total Records</p>
        </div>
        <div className="card-sm text-center">
          <p className="text-xl font-bold text-green-400">+{totalIn.toLocaleString()}</p>
          <p className="text-slate-500 text-xs mt-0.5">Total Stock In</p>
        </div>
        <div className="card-sm text-center">
          <p className="text-xl font-bold text-red-400">−{totalOut.toLocaleString()}</p>
          <p className="text-slate-500 text-xs mt-0.5">Total Stock Out</p>
        </div>
        <div className="card-sm text-center">
          <p className="text-xl font-bold text-teal-400">{issuanceCount}</p>
          <p className="text-slate-500 text-xs mt-0.5">Issuance Records</p>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16 text-slate-500">
          <History className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="font-medium">No records found</p>
          <p className="text-sm mt-1">Try adjusting your date range or filters.</p>
        </div>
      ) : (
        <Table>
          <Thead>
            <tr>
              <Th {...thProps('date')}>Date</Th>
              <Th {...thProps('items.part_number')}>Part #</Th>
              <Th {...thProps('items.name')}>Item Name</Th>
              <Th {...thProps('items.stores.name')}>Store</Th>
              <Th {...thProps('note')}>Type</Th>
              <Th {...thProps('quantity_change')}>Change</Th>
              <Th {...thProps('new_quantity')}>New Qty</Th>
              <Th {...thProps('updated_by')}>Updated By</Th>
              <Th {...thProps('note')}>Note</Th>
            </tr>
          </Thead>
          <Tbody>
            {sorted.map(r => {
              const isIn       = r.quantity_change > 0
              const isIssuance = (r.note||'').toLowerCase().includes('issuance')
              return (
                <Tr key={r.id}>
                  <Td className="text-slate-400 text-xs whitespace-nowrap">{r.date}</Td>
                  <Td className="font-mono text-xs text-slate-300">{r.items?.part_number || '—'}</Td>
                  <Td className="font-medium text-slate-100 max-w-xs">
                    <span className="block truncate">{r.items?.name || '—'}</span>
                  </Td>
                  <Td className="text-slate-400 text-xs">{r.items?.stores?.name || '—'}</Td>
                  <Td>
                    {isIssuance
                      ? <Badge variant="teal">Issuance</Badge>
                      : isIn
                        ? <Badge variant="green">Stock In</Badge>
                        : <Badge variant="orange">Adjustment</Badge>}
                  </Td>
                  <Td>
                    <span className={`flex items-center gap-1 text-sm font-bold ${isIn ? 'text-green-400' : 'text-red-400'}`}>
                      {isIn ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                      {isIn ? '+' : ''}{r.quantity_change}
                    </span>
                  </Td>
                  <Td className="text-slate-300">
                    {r.new_quantity}
                    <span className="text-slate-500 text-xs ml-1">{r.items?.unit}</span>
                  </Td>
                  <Td className="text-slate-400 text-xs">{r.updated_by || '—'}</Td>
                  <Td className="text-slate-500 text-xs max-w-xs">
                    <span className="block truncate">{r.note || '—'}</span>
                  </Td>
                </Tr>
              )
            })}
          </Tbody>
        </Table>
      )}

      {filtered.length > 0 && (
        <p className="text-center text-xs text-slate-500">
          Showing {filtered.length.toLocaleString()} records · {dateFrom} to {dateTo}
        </p>
      )}
    </div>
  )
}
