import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { ShoppingCart, Download, RefreshCw, Minus, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'

// ── Delivery day logic ────────────────────────────────────
function nextDelivery() {
  const today = new Date()
  const day   = today.getDay() // 0=Sun,1=Mon,...,4=Thu,6=Sat
  // Mondays (1) and Thursdays (4)
  const targets = [1, 4]
  let minDiff = 8
  let next    = null
  for (const t of targets) {
    let diff = (t - day + 7) % 7
    if (diff === 0) diff = 7  // next occurrence, not today
    if (diff < minDiff) { minDiff = diff; next = t }
  }
  const d = new Date(today)
  d.setDate(d.getDate() + minDiff)
  return { date: d, label: d.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' }) }
}

function weekRange(weeksBack = 0) {
  const now    = new Date()
  const toDate = new Date(now); toDate.setDate(toDate.getDate() - weeksBack * 7)
  const frDate = new Date(toDate); frDate.setDate(frDate.getDate() - 7)
  return { from: frDate.toISOString().split('T')[0], to: toDate.toISOString().split('T')[0] }
}

export default function Orders() {
  const [rows,      setRows]      = useState([])
  const [delivery,  setDelivery]  = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [exporting, setExporting] = useState(false)
  const [resortName, setResortName] = useState('Outrigger Maafushivaru Resort')

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      // Fetch resort name from settings
      const { data: settings } = await supabase.from('settings').select('key,value')
      const smap = (settings||[]).reduce((a,s) => ({ ...a, [s.key]: s.value }), {})
      if (smap.resort_name) setResortName(smap.resort_name)

      // Fetch items
      const { data: items } = await supabase
        .from('items').select('*, stores(name, category)')

      // Fetch this week + last week issuances
      const thisWeek = weekRange(0)
      const lastWeek = weekRange(1)

      const { data: thisIss } = await supabase.from('issuances')
        .select('item_id, quantity_issued').gte('date', thisWeek.from).lte('date', thisWeek.to)
      const { data: lastIss } = await supabase.from('issuances')
        .select('item_id, quantity_issued').gte('date', lastWeek.from).lte('date', lastWeek.to)

      // Sum per item
      const sum = (list, id) => (list||[]).filter(i => i.item_id === id).reduce((s,i) => s+Number(i.quantity_issued), 0)

      const orderRows = (items||[]).map(item => {
        const thisTotal = sum(thisIss, item.id)
        const lastTotal = sum(lastIss, item.id)
        const avgWeekly = (thisTotal + lastTotal) / 2
        const suggested = Math.max(0, Math.ceil(avgWeekly * 2 - Number(item.current_stock)))
        return {
          id:         item.id,
          part_number: item.part_number,
          name:       item.name,
          store:      item.stores?.name || '',
          category:   item.stores?.category || '',
          unit:       item.unit,
          current_stock: item.current_stock,
          min_stock:  item.min_stock,
          thisWeek:   thisTotal,
          lastWeek:   lastTotal,
          avgWeekly:  Math.round(avgWeekly * 10) / 10,
          suggested,
          ordered:    suggested,  // editable
        }
      }).filter(r => r.suggested > 0 || r.current_stock <= r.min_stock)
        .sort((a,b) => a.store.localeCompare(b.store) || a.name.localeCompare(b.name))

      setRows(orderRows)
      setDelivery(nextDelivery())
    } catch (err) {
      toast.error('Failed: ' + err.message)
    }
    setLoading(false)
  }, [])

  const adjustQty = (id, delta) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ordered: Math.max(0, (r.ordered || 0) + delta) } : r))
  }
  const setQty = (id, val) => {
    const n = parseInt(val, 10)
    if (!isNaN(n) && n >= 0) setRows(prev => prev.map(r => r.id === id ? { ...r, ordered: n } : r))
  }

  const exportPDF = async () => {
    if (!rows.length || !delivery) return
    setExporting(true)
    try {
      const { default: jsPDF }     = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      const primary = [15, 118, 110]
      const delivDay = delivery.date.toLocaleDateString('en-US', { weekday:'long' })
      const delivDate = delivery.date.toLocaleDateString('en-US', { day:'numeric', month:'long', year:'numeric' })
      const title = `Order for ${delivDay} – ${delivDate}`

      // Header
      doc.setFillColor(...primary)
      doc.rect(0, 0, 210, 28, 'F')
      doc.setTextColor(255,255,255)
      doc.setFontSize(18); doc.setFont('helvetica','bold')
      doc.text(resortName, 14, 12)
      doc.setFontSize(13); doc.setFont('helvetica','normal')
      doc.text(title, 14, 21)
      doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { dateStyle:'medium' })}`, 14, 27)

      // Group by store
      const grouped = rows.reduce((acc, r) => {
        (acc[r.store] = acc[r.store] || []).push(r)
        return acc
      }, {})
      let y = 36
      for (const [store, items] of Object.entries(grouped)) {
        doc.setTextColor(0,0,0)
        doc.setFontSize(11); doc.setFont('helvetica','bold')
        doc.text(store, 14, y)
        autoTable(doc, {
          startY: y + 3,
          head: [['Part #','Item Name','Unit','Current Stock','Avg Wkly','Suggested','Order Qty']],
          body: items.map(i => [i.part_number, i.name, i.unit, i.current_stock, i.avgWeekly, i.suggested, i.ordered]),
          headStyles: { fillColor: primary, fontSize: 9 },
          styles: { fontSize: 9 },
          alternateRowStyles: { fillColor: [248,250,252] },
        })
        y = doc.lastAutoTable.finalY + 8
      }

      doc.save(`Order_for_${delivDay}_${delivery.date.toISOString().split('T')[0]}.pdf`)
      toast.success('Order PDF exported')
    } catch (err) {
      toast.error('Export failed: ' + err.message)
    }
    setExporting(false)
  }

  const toOrder = rows.filter(r => r.ordered > 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Order Sheet</h1>
          {delivery && <p className="page-sub">Next delivery: <strong className="text-teal-400">{delivery.label}</strong></p>}
        </div>
        <div className="flex gap-2">
          {rows.length > 0 && (
            <Button variant="secondary" onClick={exportPDF} loading={exporting}>
              <Download className="w-4 h-4" /> Export PDF
            </Button>
          )}
          <Button onClick={generate} loading={loading}>
            <RefreshCw className="w-4 h-4" /> Generate Order
          </Button>
        </div>
      </div>

      {!rows.length && !loading && (
        <div className="card text-center py-20 text-slate-500">
          <ShoppingCart className="w-14 h-14 mx-auto mb-4 opacity-20" />
          <p className="font-medium text-lg">No order generated yet</p>
          <p className="text-sm mt-1">Click "Generate Order" to calculate suggested quantities based on usage history.</p>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-20">
          <div className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {rows.length > 0 && !loading && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="card-sm text-center">
              <p className="text-2xl font-bold text-teal-400">{rows.length}</p>
              <p className="text-slate-400 text-sm mt-1">Items to order</p>
            </div>
            <div className="card-sm text-center">
              <p className="text-2xl font-bold text-teal-400">{toOrder.reduce((s,r) => s + r.ordered, 0)}</p>
              <p className="text-slate-400 text-sm mt-1">Total units</p>
            </div>
            <div className="card-sm text-center col-span-2 sm:col-span-1">
              <p className="font-medium text-slate-100">{delivery?.date.toLocaleDateString('en-US',{weekday:'long'})}</p>
              <p className="text-slate-400 text-sm mt-1">{delivery?.date.toLocaleDateString('en-US',{day:'numeric',month:'short',year:'numeric'})}</p>
            </div>
          </div>

          <div className="card">
            <p className="text-xs text-slate-400 mb-4">
              Formula: Suggested Qty = (Avg weekly usage × 2) − Current Stock. Adjust quantities as needed before exporting.
            </p>
            <Table>
              <Thead><tr>
                <Th>Part #</Th><Th>Item Name</Th><Th>Store</Th><Th>Unit</Th>
                <Th>Current</Th><Th>Avg/Wk</Th><Th>Suggested</Th><Th>Order Qty</Th>
              </tr></Thead>
              <Tbody>
                {rows.map(row => (
                  <Tr key={row.id} className={row.ordered === 0 ? 'opacity-50' : ''}>
                    <Td className="font-mono text-xs text-slate-300">{row.part_number}</Td>
                    <Td className="font-medium text-slate-100 max-w-xs truncate">{row.name}</Td>
                    <Td><span className="text-xs text-slate-400">{row.store}</span></Td>
                    <Td className="text-slate-400 text-xs">{row.unit}</Td>
                    <Td className={Number(row.current_stock) <= Number(row.min_stock) ? 'text-red-400 font-semibold' : 'text-slate-300'}>
                      {row.current_stock}
                    </Td>
                    <Td className="text-slate-300">{row.avgWeekly}</Td>
                    <Td><Badge variant="teal">{row.suggested}</Badge></Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => adjustQty(row.id, -1)}
                          className="w-7 h-7 flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-slate-300">
                          <Minus className="w-3 h-3" />
                        </button>
                        <input
                          type="number" min="0"
                          value={row.ordered}
                          onChange={e => setQty(row.id, e.target.value)}
                          className="w-16 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-center text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                        <button onClick={() => adjustQty(row.id, 1)}
                          className="w-7 h-7 flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-slate-300">
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
