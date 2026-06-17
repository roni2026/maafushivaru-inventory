import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import {
  AlertTriangle, Plus, CheckCircle2, CreditCard, Trash2,
  Search, Download, RefreshCw, X, Building2, Filter
} from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import ReportClaimModal, { ISSUE_TYPES, ISSUE_BADGE_VARIANT } from '../components/ReportClaimModal'

const STATUS_CONFIG = {
  pending:   { label: 'Pending',   variant: 'yellow', icon: '⏳' },
  contacted: { label: 'Contacted', variant: 'blue',   icon: '📞' },
  resolved:  { label: 'Resolved',  variant: 'green',  icon: '✓'  },
  credited:  { label: 'Credited',  variant: 'teal',   icon: '💳' },
}

export default function Claims() {
  const [claims,       setClaims]       = useState([])
  const [loading,      setLoading]      = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [updatingId,   setUpdatingId]   = useState(null)

  // Filters
  const [search,       setSearch]       = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType,   setFilterType]   = useState('')
  const [filterSupplier,setFilterSupplier]=useState('')

  // Unique suppliers from loaded claims (for quick filter)
  const suppliers = useMemo(() => [...new Set(claims.map(c => c.supplier_name))].sort(), [claims])

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('delivery_claims')
      .select('*')
      .order('date', { ascending: false })
    if (error) toast.error(error.message)
    else setClaims(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    let list = [...claims]
    if (search)         list = list.filter(c => c.item_name.toLowerCase().includes(search.toLowerCase()) || c.part_number?.toLowerCase().includes(search.toLowerCase()))
    if (filterStatus)   list = list.filter(c => c.status   === filterStatus)
    if (filterType)     list = list.filter(c => c.issue_type === filterType)
    if (filterSupplier) list = list.filter(c => c.supplier_name === filterSupplier)
    return list
  }, [claims, search, filterStatus, filterType, filterSupplier])

  const updateStatus = async (id, newStatus) => {
    setUpdatingId(id)
    const { error } = await supabase
      .from('delivery_claims')
      .update({
        status:      newStatus,
        resolved_at: ['resolved','credited'].includes(newStatus) ? new Date().toISOString() : null,
      })
      .eq('id', id)
    if (error) toast.error(error.message)
    else {
      setClaims(prev => prev.map(c => c.id === id ? { ...c, status: newStatus } : c))
      toast.success(`Claim marked as ${newStatus}`)
    }
    setUpdatingId(null)
  }

  const deleteClaim = async (id, itemName) => {
    if (!confirm(`Delete claim for "${itemName}"? This cannot be undone.`)) return
    const { error } = await supabase.from('delivery_claims').delete().eq('id', id)
    if (error) toast.error(error.message)
    else { setClaims(prev => prev.filter(c => c.id !== id)); toast.success('Claim deleted') }
  }

  // Export PDF of all pending/contacted claims (supplier dispute report)
  const exportPDF = async () => {
    const toExport = filtered.filter(c => ['pending','contacted'].includes(c.status))
    if (!toExport.length) { toast('No pending claims to export', { icon: 'ℹ️' }); return }
    try {
      const { default: jsPDF }     = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      const cyan = [0, 174, 239]

      doc.setFillColor(...cyan); doc.rect(0, 0, 210, 26, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(16); doc.setFont('helvetica', 'bold')
      doc.text('Outrigger Maafushivaru — Delivery Claims Report', 14, 12)
      doc.setFontSize(9); doc.setFont('helvetica', 'normal')
      doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { dateStyle: 'full' })}`, 14, 20)

      // Group by supplier
      const bySupplier = toExport.reduce((acc, c) => { (acc[c.supplier_name] = acc[c.supplier_name] || []).push(c); return acc }, {})
      let y = 32

      for (const [supplier, items] of Object.entries(bySupplier)) {
        doc.setTextColor(0); doc.setFontSize(12); doc.setFont('helvetica', 'bold')
        doc.text(`Supplier: ${supplier}`, 14, y)
        autoTable(doc, {
          startY: y + 3,
          head:   [['Date', 'Part #', 'Item', 'Store', 'Issue', 'Ordered', 'Received', 'Claim Qty', 'Unit', 'Notes']],
          body:   items.map(c => [
            c.date, c.part_number || '—', c.item_name, c.store_name || '—',
            ISSUE_TYPES.find(t => t.value === c.issue_type)?.label || c.issue_type,
            c.ordered_qty, c.received_qty, c.wrong_qty, c.unit, c.notes || '',
          ]),
          headStyles:        { fillColor: cyan, fontSize: 8 },
          styles:            { fontSize: 8 },
          alternateRowStyles:{ fillColor: [248, 250, 252] },
          columnStyles:      { 9: { cellWidth: 35, fontSize: 7 } },
        })
        y = doc.lastAutoTable.finalY + 10
      }
      doc.save(`Claims_Report_${new Date().toISOString().split('T')[0]}.pdf`)
      toast.success('Claims PDF exported')
    } catch (err) { toast.error('Export failed: ' + err.message) }
  }

  // Stats
  const stats = useMemo(() => ({
    total:    claims.length,
    pending:  claims.filter(c => c.status === 'pending').length,
    resolved: claims.filter(c => ['resolved','credited'].includes(c.status)).length,
    totalWrongQty: claims.reduce((s, c) => s + Number(c.wrong_qty), 0),
    topSupplier: suppliers.reduce((top, s) => {
      const cnt = claims.filter(c => c.supplier_name === s).length
      return cnt > (top.count || 0) ? { name: s, count: cnt } : top
    }, {}),
  }), [claims, suppliers])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Delivery Claims</h1>
          <p className="page-sub">Track wrong, short, or damaged deliveries — build supplier dispute reports</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={load}       className="btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={exportPDF}  className="btn-secondary btn-sm"><Download className="w-4 h-4" /> Export PDF</button>
          <Button onClick={() => setShowAddModal(true)}>
            <Plus className="w-4 h-4" /> Log Claim
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card-sm text-center border border-slate-700/40">
          <p className="text-2xl font-bold text-slate-100">{stats.total}</p>
          <p className="text-slate-400 text-xs mt-1">Total Claims</p>
        </div>
        <div className="card-sm text-center border border-yellow-700/30 bg-yellow-900/10">
          <p className="text-2xl font-bold text-yellow-400">{stats.pending}</p>
          <p className="text-slate-400 text-xs mt-1">Pending</p>
        </div>
        <div className="card-sm text-center border border-green-700/30 bg-green-900/10">
          <p className="text-2xl font-bold text-green-400">{stats.resolved}</p>
          <p className="text-slate-400 text-xs mt-1">Resolved / Credited</p>
        </div>
        <div className="card-sm text-center border border-red-700/30 bg-red-900/10">
          {stats.topSupplier.name ? (
            <>
              <p className="text-sm font-bold text-red-400 truncate">{stats.topSupplier.name}</p>
              <p className="text-slate-400 text-xs mt-1">Most claims ({stats.topSupplier.count})</p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold text-red-400">—</p>
              <p className="text-slate-400 text-xs mt-1">No claims yet</p>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card py-4 px-5 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input placeholder="Search item name or part #…" value={search} onChange={e => setSearch(e.target.value)}
            className="input pl-9 text-sm" />
          {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"><X className="w-4 h-4" /></button>}
        </div>
        <select value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)} className="input text-sm w-auto">
          <option value="">All Suppliers</option>
          {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="input text-sm w-auto">
          <option value="">All Issues</option>
          {ISSUE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="input text-sm w-auto">
          <option value="">All Statuses</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
        {(search || filterSupplier || filterType || filterStatus) && (
          <button onClick={() => { setSearch(''); setFilterSupplier(''); setFilterType(''); setFilterStatus('') }}
            className="btn-ghost btn-sm text-slate-400">
            <X className="w-4 h-4" /> Clear
          </button>
        )}
      </div>

      {/* Per-supplier summary cards (shown when no filters active) */}
      {!filterSupplier && !filterStatus && !filterType && !search && suppliers.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {suppliers.map(supplier => {
            const supplierClaims = claims.filter(c => c.supplier_name === supplier)
            const pending = supplierClaims.filter(c => c.status === 'pending').length
            const totalWrong = supplierClaims.reduce((s, c) => s + Number(c.wrong_qty), 0)
            return (
              <button key={supplier}
                onClick={() => setFilterSupplier(supplier)}
                className="card text-left hover:border-[#00AEEF]/40 border border-slate-700/40 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-slate-700 rounded-lg flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4 text-slate-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-100 text-sm">{supplier}</p>
                      <p className="text-xs text-slate-400">{supplierClaims.length} total claim{supplierClaims.length !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  {pending > 0 && (
                    <span className="text-xs font-bold text-yellow-400 bg-yellow-900/20 border border-yellow-700/30 rounded-lg px-2 py-1 shrink-0">
                      {pending} pending
                    </span>
                  )}
                </div>
                <div className="flex gap-4 mt-3 text-xs text-slate-400">
                  <span>Wrong qty: <strong className="text-red-400">{totalWrong}</strong></span>
                  <span>Resolved: <strong className="text-green-400">{supplierClaims.filter(c => ['resolved','credited'].includes(c.status)).length}</strong></span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Claims table */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-20 text-slate-500">
          <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-20" />
          {claims.length === 0 ? (
            <>
              <p className="font-medium text-lg">No claims logged yet</p>
              <p className="text-sm mt-1">When a delivery has issues, click <strong>"Log Claim"</strong> to track it.</p>
              <p className="text-xs mt-3 text-slate-600">You can also report issues directly from Order History → expand an order → click ⚠ on any item.</p>
              <button onClick={() => setShowAddModal(true)} className="btn-secondary btn-sm mx-auto mt-5">
                <Plus className="w-4 h-4" /> Log First Claim
              </button>
            </>
          ) : (
            <p className="font-medium">No claims match your filters</p>
          )}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-slate-400">{filtered.length} claim{filtered.length !== 1 ? 's' : ''}</p>
            {filterSupplier && (
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#00AEEF]" />
                <span className="text-sm font-medium text-[#00AEEF]">{filterSupplier}</span>
                <button onClick={() => setFilterSupplier('')}><X className="w-4 h-4 text-slate-400 hover:text-slate-200" /></button>
              </div>
            )}
          </div>
          <Table>
            <Thead>
              <tr>
                <Th>Date</Th>
                <Th>Part #</Th>
                <Th>Item</Th>
                <Th>Supplier</Th>
                <Th>Issue</Th>
                <Th>Ordered</Th>
                <Th>Received</Th>
                <Th>Claim Qty</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </Thead>
            <Tbody>
              {filtered.map(claim => {
                const status = STATUS_CONFIG[claim.status] || STATUS_CONFIG.pending
                const issueLabel = ISSUE_TYPES.find(t => t.value === claim.issue_type)?.label || claim.issue_type
                const isLoading = updatingId === claim.id
                return (
                  <Tr key={claim.id}>
                    <Td className="text-slate-300 text-xs whitespace-nowrap">{claim.date}</Td>
                    <Td className="font-mono text-xs text-slate-400">{claim.part_number || '—'}</Td>
                    <Td>
                      <p className="font-medium text-slate-100 text-sm">{claim.item_name}</p>
                      {claim.store_name && <p className="text-xs text-slate-500">{claim.store_name}</p>}
                      {claim.notes && <p className="text-[10px] text-slate-500 mt-0.5 italic max-w-[200px] truncate" title={claim.notes}>{claim.notes}</p>}
                    </Td>
                    <Td>
                      <span className="font-medium text-slate-200 text-sm">{claim.supplier_name}</span>
                    </Td>
                    <Td>
                      <Badge variant={ISSUE_BADGE_VARIANT[claim.issue_type] || 'gray'}>
                        {issueLabel}
                      </Badge>
                    </Td>
                    <Td className="text-slate-300 text-sm">{claim.ordered_qty || '—'}</Td>
                    <Td className="text-slate-300 text-sm">{claim.received_qty || '—'}</Td>
                    <Td>
                      <span className="font-bold text-red-400 text-base">{claim.wrong_qty}</span>
                      <span className="text-slate-500 text-xs ml-1">{claim.unit}</span>
                    </Td>
                    <Td>
                      <Badge variant={status.variant}>{status.icon} {status.label}</Badge>
                    </Td>
                    <Td>
                      <div className="flex items-center justify-end gap-0.5">
                        {/* Status progression buttons */}
                        {claim.status === 'pending' && (
                          <button onClick={() => updateStatus(claim.id, 'contacted')} disabled={isLoading}
                            className="p-1.5 text-xs text-blue-400 hover:bg-blue-900/30 rounded-lg transition-colors"
                            title="Mark as Contacted">
                            📞
                          </button>
                        )}
                        {['pending','contacted'].includes(claim.status) && (
                          <>
                            <button onClick={() => updateStatus(claim.id, 'resolved')} disabled={isLoading}
                              className="p-1.5 text-green-400 hover:bg-green-900/30 rounded-lg transition-colors"
                              title="Mark as Resolved">
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                            <button onClick={() => updateStatus(claim.id, 'credited')} disabled={isLoading}
                              className="p-1.5 text-teal-400 hover:bg-teal-900/30 rounded-lg transition-colors"
                              title="Mark as Credited (credit note received)">
                              <CreditCard className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {['resolved','credited'].includes(claim.status) && (
                          <button onClick={() => updateStatus(claim.id, 'pending')} disabled={isLoading}
                            className="p-1.5 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors text-xs"
                            title="Reopen claim">
                            ↩
                          </button>
                        )}
                        <button onClick={() => deleteClaim(claim.id, claim.item_name)} disabled={isLoading}
                          className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </Tbody>
          </Table>
        </div>
      )}

      {/* Add claim modal */}
      {showAddModal && (
        <ReportClaimModal
          onClose={() => setShowAddModal(false)}
          onSaved={load}
        />
      )}
    </div>
  )
}
