import { useState, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Plus, Search, Pencil, Trash2, RefreshCw, PackagePlus,
  Download, Upload, ExternalLink, Printer, Camera, MapPin, X
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useItems } from '../hooks/useItems'
import { supabase } from '../lib/supabase'
import Modal from '../components/ui/Modal'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import Input, { Select, Textarea } from '../components/ui/Input'
import { ImageModal, LocationModal } from '../components/ItemMedia'

// ── helpers ───────────────────────────────────────────────
function daysUntil(d) {
  if (!d) return null
  const exp=new Date(d);exp.setHours(0,0,0,0);const now=new Date();now.setHours(0,0,0,0)
  return Math.ceil((exp-now)/86400000)
}
function rowClass(days){
  if(days===null) return 'row-none'
  if(days<0||days<=7) return 'row-expired'
  if(days<=15) return 'row-critical'
  if(days<=30) return 'row-warning'
  return 'row-ok'
}
function expiryBadge(days){
  if(days===null) return <Badge variant="gray">No expiry</Badge>
  if(days<0)      return <Badge variant="red">Expired {Math.abs(days)}d ago</Badge>
  if(days<=7)     return <Badge variant="red">{days}d left</Badge>
  if(days<=15)    return <Badge variant="orange">{days}d left</Badge>
  if(days<=30)    return <Badge variant="yellow">{days}d left</Badge>
  return                 <Badge variant="green">{days}d left</Badge>
}

const EMPTY_FORM = {
  part_number:'',name:'',store_id:'',unit:'pcs',
  current_stock:'',min_stock:'',expiry_date:'',
  supplier:'',notes:'',unit_cost:'',location:'',image_url:'',
}
const UNITS = ['pcs','kg','g','L','mL','bottle','box','case','can','bag','jar','pack','roll','set']
const SEARCH_FIELDS = [
  { value:'name',        label:'Item Name'   },
  { value:'part_number', label:'Part #'      },
  { value:'notes',       label:'Description' },
  { value:'location',    label:'Location'    },
]

export default function Inventory() {
  const { items, stores, loading, addItem, updateItem, deleteItem, updateStock, refetch } = useItems()

  // ── Search / filter ──────────────────────────────────────
  const [searchField, setSearchField] = useState('name')
  const [search,      setSearch]      = useState('')
  const [filterStore, setFilterStore] = useState('')
  const [filterCat,   setFilterCat]   = useState('')
  const [filterExp,   setFilterExp]   = useState('')
  const [sortField,   setSortField]   = useState('expiry_date')
  const [sortDir,     setSortDir]     = useState('asc')

  // ── Modals ───────────────────────────────────────────────
  const [showAdd,    setShowAdd]    = useState(false)
  const [editItem,   setEditItem]   = useState(null)
  const [stockItem,  setStockItem]  = useState(null)
  const [deleteConf, setDeleteConf] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [imageItem,  setImageItem]  = useState(null) // image modal
  const [locItem,    setLocItem]    = useState(null) // location modal
  const [form,       setForm]       = useState(EMPTY_FORM)
  const [saving,     setSaving]     = useState(false)

  // ── Stock update ─────────────────────────────────────────
  const [stockQty,  setStockQty]  = useState('')
  const [stockNote, setStockNote] = useState('')
  const [stockDate, setStockDate] = useState(new Date().toISOString().split('T')[0])
  const [stockUser, setStockUser] = useState('')
  const [stockMode, setStockMode] = useState('set')

  // ── CSV import ───────────────────────────────────────────
  const [csvRows,   setCsvRows]   = useState([])
  const [csvErrors, setCsvErrors] = useState([])
  const [importing, setImporting] = useState(false)
  const fileRef = useRef(null)

  const categories = useMemo(() => [...new Set(stores.map(s=>s.category))].sort(), [stores])

  const filtered = useMemo(() => {
    let list=[...items]
    if (search) {
      const q=search.toLowerCase()
      list=list.filter(i=>(i[searchField]||'').toLowerCase().includes(q))
    }
    if (filterStore) list=list.filter(i=>i.store_id===filterStore)
    if (filterCat)   list=list.filter(i=>i.stores?.category===filterCat)
    if (filterExp) {
      list=list.filter(i=>{
        const d=daysUntil(i.expiry_date)
        if(filterExp==='expired') return d!==null&&d<0
        if(filterExp==='7')       return d!==null&&d>=0&&d<=7
        if(filterExp==='15')      return d!==null&&d>=0&&d<=15
        if(filterExp==='30')      return d!==null&&d>=0&&d<=30
        if(filterExp==='ok')      return d===null||d>30
        return true
      })
    }
    list.sort((a,b)=>{
      let va=a[sortField],vb=b[sortField]
      if(sortField==='expiry_date'){ if(!va)return 1; if(!vb)return -1; va=new Date(va); vb=new Date(vb) }
      else if(typeof va==='string'){ va=va.toLowerCase(); vb=(vb||'').toLowerCase() }
      return sortDir==='asc'?(va>vb?1:-1):(va<vb?1:-1)
    })
    return list
  }, [items, search, searchField, filterStore, filterCat, filterExp, sortField, sortDir])

  const toggleSort = (field) => {
    if(sortField===field) setSortDir(d=>d==='asc'?'desc':'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const openAdd  = () => { setForm(EMPTY_FORM); setShowAdd(true) }
  const openEdit = (item) => {
    setEditItem(item)
    setForm({
      part_number:item.part_number, name:item.name, store_id:item.store_id,
      unit:item.unit, current_stock:item.current_stock, min_stock:item.min_stock,
      expiry_date:item.expiry_date||'', supplier:item.supplier||'',
      notes:item.notes||'', unit_cost:item.unit_cost||'',
      location:item.location||'', image_url:item.image_url||'',
    })
  }

  const handleSave = async () => {
    if(!form.part_number||!form.name||!form.store_id){ toast.error('Part #, Name, Store required'); return }
    setSaving(true)
    try {
      const payload={...form,current_stock:Number(form.current_stock)||0,min_stock:Number(form.min_stock)||0,unit_cost:Number(form.unit_cost)||0}
      if(editItem){ await updateItem(editItem.id,payload); toast.success('Updated'); setEditItem(null) }
      else        { await addItem(payload); toast.success('Item added'); setShowAdd(false) }
    } catch(err){ toast.error(err.message) }
    setSaving(false)
  }

  const handleDelete = async () => {
    try{ await deleteItem(deleteConf.id); toast.success('Deleted'); setDeleteConf(null) }
    catch(err){ toast.error(err.message) }
  }

  const handleStock = async () => {
    const q=Number(stockQty); if(isNaN(q)||q<=0){ toast.error('Invalid quantity'); return }
    const current=Number(stockItem.current_stock)
    const newQty=stockMode==='set'?q:stockMode==='add'?current+q:Math.max(0,current-q)
    setSaving(true)
    try{
      await updateStock({itemId:stockItem.id,quantityChange:newQty-current,newQuantity:newQty,updatedBy:stockUser||'Manual',note:stockNote,date:stockDate})
      toast.success(`Stock → ${newQty}`)
      setStockItem(null); setStockQty(''); setStockNote(''); setStockUser('')
    } catch(err){ toast.error(err.message) }
    setSaving(false)
  }

  const f = (k) => (e) => setForm(p=>({...p,[k]:e.target.value}))

  // When image/location modal saves, update the items list in-place
  const handleMediaUpdate = (updatedItem) => {
    // Update imageItem / locItem state so modal reflects changes
    if (imageItem?.id === updatedItem.id) setImageItem(updatedItem)
    if (locItem?.id   === updatedItem.id) setLocItem(updatedItem)
    // Trigger a refetch to refresh the table
    refetch()
  }

  // ── CSV import ───────────────────────────────────────────
  const downloadTemplate = () => {
    const csv='part_number,name,store_name,unit,current_stock,min_stock,expiry_date,supplier,unit_cost,location,notes\nBEV-001,Mineral Water 500mL,Beverage Dry Store,bottle,100,20,2026-12-31,Maldives Fresh Co,1.50,Shelf A1,Keep cool'
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    a.download='inventory_template.csv'; a.click(); toast.success('Template downloaded')
  }

  const handleFileChange = (e) => {
    const file=e.target.files?.[0]; if(!file) return
    const reader=new FileReader()
    reader.onload=(ev)=>{
      const text=ev.target.result
      const lines=text.split('\n').map(l=>l.trim()).filter(Boolean)
      if(lines.length<2){ toast.error('CSV is empty'); return }
      const headers=lines[0].split(',').map(h=>h.replace(/^"|"$/g,'').trim().toLowerCase())
      const required=['part_number','name','store_name','unit','current_stock','min_stock']
      const missing=required.filter(r=>!headers.includes(r))
      if(missing.length){ toast.error(`CSV missing: ${missing.join(', ')}`); return }
      const parsed=[]; const errs=[]
      lines.slice(1).forEach((line,idx)=>{
        const vals=line.split(',').map(v=>v.replace(/^"|"$/g,'').trim())
        const row={}; headers.forEach((h,i)=>{ row[h]=vals[i]||'' })
        const store=stores.find(s=>s.name.toLowerCase()===row.store_name?.toLowerCase())
        if(!store) errs.push(`Row ${idx+2}: Store "${row.store_name}" not found`)
        else parsed.push({...row,store_id:store.id,current_stock:Number(row.current_stock)||0,min_stock:Number(row.min_stock)||0,unit_cost:Number(row.unit_cost)||0})
      })
      setCsvRows(parsed); setCsvErrors(errs)
    }
    reader.readAsText(file)
  }

  const handleImport = async () => {
    if(!csvRows.length){ toast.error('No valid rows'); return }
    setImporting(true)
    let success=0
    for(const row of csvRows){
      const {error}=await supabase.from('items').upsert(
        {part_number:row.part_number,name:row.name,store_id:row.store_id,unit:row.unit,current_stock:row.current_stock,min_stock:row.min_stock,expiry_date:row.expiry_date||null,supplier:row.supplier||'',notes:row.notes||'',unit_cost:row.unit_cost||0,location:row.location||''},
        {onConflict:'part_number',ignoreDuplicates:false}
      )
      if(!error) success++
    }
    toast.success(`Imported ${success} items`)
    setShowImport(false); setCsvRows([]); setCsvErrors([]); refetch()
    setImporting(false)
  }

  const inventoryValue=items.reduce((s,i)=>s+Number(i.current_stock)*Number(i.unit_cost||0),0)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Inventory</h1>
          <p className="page-sub">
            {filtered.length} of {items.length} items
            {inventoryValue>0 && <> · Value: <strong className="text-teal-400">${inventoryValue.toFixed(2)}</strong></>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={refetch} className="btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={()=>window.print()} className="btn-secondary btn-sm" title="Print"><Printer className="w-4 h-4" /></button>
          <button onClick={()=>setShowImport(true)} className="btn-secondary btn-sm"><Upload className="w-4 h-4" /> Import CSV</button>
          <Button onClick={openAdd}><Plus className="w-4 h-4" /> Add Item</Button>
        </div>
      </div>

      {/* ── Filters row ──────────────────────────────────── */}
      <div className="card py-4 px-5 flex flex-wrap gap-3 items-center">
        {/* Search type selector + input */}
        <div className="flex items-center gap-0 flex-1 min-w-60">
          <div className="relative">
            <select
              value={searchField} onChange={e=>{ setSearchField(e.target.value); setSearch('') }}
              className="input text-sm rounded-r-none border-r-0 pr-8 w-auto appearance-none bg-slate-600 border-slate-500">
              {SEARCH_FIELDS.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          </div>
          <div className="relative flex-1">
            <input
              placeholder={`Search by ${SEARCH_FIELDS.find(f=>f.value===searchField)?.label}…`}
              value={search} onChange={e=>setSearch(e.target.value)}
              className="input rounded-l-none border-l border-slate-600 text-sm" />
            {search && (
              <button onClick={()=>setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        <select value={filterStore} onChange={e=>setFilterStore(e.target.value)} className="input text-sm w-auto">
          <option value="">All Stores</option>
          {stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={filterCat} onChange={e=>setFilterCat(e.target.value)} className="input text-sm w-auto">
          <option value="">All Categories</option>
          {categories.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterExp} onChange={e=>setFilterExp(e.target.value)} className="input text-sm w-auto">
          <option value="">All Expiry</option>
          <option value="expired">Expired</option>
          <option value="7">≤ 7 days</option>
          <option value="15">≤ 15 days</option>
          <option value="30">≤ 30 days</option>
          <option value="ok">Good (&gt;30d)</option>
        </select>
      </div>

      {/* Legend */}
      <div className="flex gap-3 flex-wrap text-xs text-slate-400">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500" /> Expired/≤7d</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-500" /> 8–15d</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-500" /> 16–30d</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-600" /> &gt;30d</span>
        <span className="flex items-center gap-1 ml-4 text-teal-400"><Camera className="w-3 h-3" /> = has photo</span>
        <span className="flex items-center gap-1 text-blue-400"><MapPin className="w-3 h-3" /> = location set</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length===0 ? (
        <div className="card text-center py-16 text-slate-500">
          <p className="font-medium">No items found</p>
          <p className="text-sm mt-1">Try a different search, or use "Import CSV" / "Add Item".</p>
        </div>
      ) : (
        <Table>
          <Thead>
            <tr>
              <Th sortable onClick={()=>toggleSort('part_number')} sorted={sortField==='part_number'?sortDir:undefined}>Part #</Th>
              <Th sortable onClick={()=>toggleSort('name')} sorted={sortField==='name'?sortDir:undefined}>Item Name</Th>
              <Th>Store</Th>
              <Th>Unit</Th>
              <Th sortable onClick={()=>toggleSort('current_stock')} sorted={sortField==='current_stock'?sortDir:undefined}>Stock</Th>
              <Th>Min</Th>
              <Th>Cost</Th>
              <Th sortable onClick={()=>toggleSort('expiry_date')} sorted={sortField==='expiry_date'?sortDir:undefined}>Expiry</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </Thead>
          <Tbody>
            {filtered.map(item => {
              const days=daysUntil(item.expiry_date)
              const lowStock=Number(item.current_stock)<=Number(item.min_stock)
              const hasImage=!!item.image_url
              const hasLoc  =!!item.location
              return (
                <Tr key={item.id} className={rowClass(days)}>
                  <Td className="font-mono text-xs text-slate-300">{item.part_number}</Td>
                  <Td className="font-medium max-w-xs">
                    <Link to={`/inventory/${item.id}`} className="text-slate-100 hover:text-teal-400 transition-colors flex items-center gap-1 group truncate">
                      <span className="truncate">{item.name}</span>
                      <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-50 shrink-0 transition-opacity" />
                    </Link>
                    {item.location && (
                      <p className="text-[10px] text-slate-500 mt-0.5 truncate flex items-center gap-1">
                        <MapPin className="w-2.5 h-2.5 text-blue-400" />{item.location}
                      </p>
                    )}
                  </Td>
                  <Td className="text-xs text-slate-400">{item.stores?.name}</Td>
                  <Td className="text-xs text-slate-400">{item.unit}</Td>
                  <Td>
                    <span className={`font-semibold ${lowStock?'text-red-400':'text-slate-100'}`}>{item.current_stock}</span>
                    {lowStock&&<span className="ml-1 text-red-400 text-xs">⚠</span>}
                  </Td>
                  <Td className="text-slate-400">{item.min_stock}</Td>
                  <Td className="text-slate-400 text-xs">{Number(item.unit_cost||0)>0?`$${Number(item.unit_cost).toFixed(2)}`:'—'}</Td>
                  <Td>{expiryBadge(days)}</Td>
                  <Td>
                    <div className="flex items-center justify-end gap-0.5">
                      {/* Image button */}
                      <button onClick={()=>setImageItem(item)}
                        className={`p-1.5 rounded-lg transition-colors ${hasImage?'text-teal-400 hover:bg-teal-900/30':'text-slate-600 hover:bg-slate-700 hover:text-slate-300'}`}
                        title={hasImage?'View photo':'Upload photo'}>
                        <Camera className="w-4 h-4" />
                      </button>
                      {/* Location button */}
                      <button onClick={()=>setLocItem(item)}
                        className={`p-1.5 rounded-lg transition-colors ${hasLoc?'text-blue-400 hover:bg-blue-900/30':'text-slate-600 hover:bg-slate-700 hover:text-slate-300'}`}
                        title={hasLoc?`Location: ${item.location}`:'Set location'}>
                        <MapPin className="w-4 h-4" />
                      </button>
                      {/* Stock update */}
                      <button onClick={()=>{setStockItem(item);setStockQty('');setStockNote('');setStockMode('set');setStockDate(new Date().toISOString().split('T')[0])}}
                        className="p-1.5 hover:bg-teal-700/30 rounded-lg transition-colors text-teal-400" title="Update Stock">
                        <PackagePlus className="w-4 h-4" />
                      </button>
                      {/* Edit */}
                      <button onClick={()=>openEdit(item)} className="p-1.5 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-slate-100">
                        <Pencil className="w-4 h-4" />
                      </button>
                      {/* Delete */}
                      <button onClick={()=>setDeleteConf(item)} className="p-1.5 hover:bg-red-900/30 rounded-lg transition-colors text-slate-400 hover:text-red-400">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Tbody>
        </Table>
      )}

      {/* ── Add/Edit modal ───────────────────────────────── */}
      <Modal isOpen={showAdd||!!editItem} onClose={()=>{setShowAdd(false);setEditItem(null)}}
        title={editItem?'Edit Item':'Add New Item'}
        footer={<><Button variant="secondary" onClick={()=>{setShowAdd(false);setEditItem(null)}}>Cancel</Button><Button onClick={handleSave} loading={saving}>Save</Button></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Part Number *" value={form.part_number} onChange={f('part_number')} placeholder="e.g. BEV-001" />
          <Input label="Item Name *" value={form.name} onChange={f('name')} placeholder="e.g. Mineral Water 500mL" />
          <Select label="Store *" value={form.store_id} onChange={f('store_id')}>
            <option value="">Select store…</option>
            {stores.map(s=><option key={s.id} value={s.id}>{s.name} ({s.category})</option>)}
          </Select>
          <Select label="Unit" value={form.unit} onChange={f('unit')}>
            {UNITS.map(u=><option key={u} value={u}>{u}</option>)}
          </Select>
          <Input label="Current Stock" type="number" min="0" step="0.01" value={form.current_stock} onChange={f('current_stock')} />
          <Input label="Minimum Stock Level" type="number" min="0" step="0.01" value={form.min_stock} onChange={f('min_stock')} />
          <Input label="Unit Cost ($)" type="number" min="0" step="0.01" value={form.unit_cost} onChange={f('unit_cost')} placeholder="0.00" />
          <Input label="Expiry Date" type="date" value={form.expiry_date} onChange={f('expiry_date')} />
          <Input label="Supplier" value={form.supplier} onChange={f('supplier')} placeholder="Supplier name" />
          <Input label="Location in Store" value={form.location} onChange={f('location')} placeholder="e.g. Shelf B3, Row 2" />
          <div className="sm:col-span-2">
            <Textarea label="Description / Notes" value={form.notes} onChange={f('notes')} placeholder="Any notes or description…" rows={2} />
          </div>
          {editItem && (
            <div className="sm:col-span-2 text-xs text-slate-500">
              💡 To upload/change the item photo, close this and click the <Camera className="w-3 h-3 inline text-teal-400" /> icon in the table row.
            </div>
          )}
        </div>
      </Modal>

      {/* ── Stock update ─────────────────────────────────── */}
      <Modal isOpen={!!stockItem} onClose={()=>setStockItem(null)} title="Update Stock" size="sm"
        footer={<><Button variant="secondary" onClick={()=>setStockItem(null)}>Cancel</Button><Button onClick={handleStock} loading={saving}>Update</Button></>}>
        {stockItem&&(
          <div className="space-y-4">
            <div className="bg-slate-700/40 rounded-lg p-3">
              <p className="font-medium text-slate-100">{stockItem.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">{stockItem.part_number} · <strong className="text-teal-400">{stockItem.current_stock} {stockItem.unit}</strong></p>
            </div>
            <Select label="Mode" value={stockMode} onChange={e=>setStockMode(e.target.value)}>
              <option value="set">Set exact quantity</option>
              <option value="add">Add to current stock</option>
              <option value="subtract">Subtract from stock</option>
            </Select>
            <Input label={`Quantity (${stockItem.unit})`} type="number" min="0" step="0.01" value={stockQty} onChange={e=>setStockQty(e.target.value)} />
            <Input label="Date" type="date" value={stockDate} onChange={e=>setStockDate(e.target.value)} />
            <Input label="Updated By" value={stockUser} onChange={e=>setStockUser(e.target.value)} placeholder="Your name" />
            <Input label="Note" value={stockNote} onChange={e=>setStockNote(e.target.value)} />
            {stockQty&&<div className="bg-teal-900/30 border border-teal-700/40 rounded-lg p-3 text-sm">New stock: <strong className="text-teal-300">{stockMode==='set'?Number(stockQty):stockMode==='add'?Number(stockItem.current_stock)+Number(stockQty):Math.max(0,Number(stockItem.current_stock)-Number(stockQty))} {stockItem.unit}</strong></div>}
          </div>
        )}
      </Modal>

      {/* ── Delete confirm ───────────────────────────────── */}
      <Modal isOpen={!!deleteConf} onClose={()=>setDeleteConf(null)} title="Delete Item" size="sm"
        footer={<><Button variant="secondary" onClick={()=>setDeleteConf(null)}>Cancel</Button><Button variant="danger" onClick={handleDelete}>Delete</Button></>}>
        {deleteConf&&<p className="text-slate-300">Delete <strong className="text-slate-100">{deleteConf.name}</strong>? This cannot be undone.</p>}
      </Modal>

      {/* ── CSV import ───────────────────────────────────── */}
      <Modal isOpen={showImport} onClose={()=>{setShowImport(false);setCsvRows([]);setCsvErrors([]);if(fileRef.current)fileRef.current.value=''}}
        title="Bulk Import via CSV"
        footer={<><Button variant="secondary" onClick={downloadTemplate}><Download className="w-4 h-4" /> Template</Button>{csvRows.length>0&&<Button onClick={handleImport} loading={importing}>Import {csvRows.length} Items</Button>}</>}>
        <div className="space-y-4">
          <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-3 text-sm text-blue-300">
            Download the template, fill in your items (store_name must match exactly), then upload.
          </div>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFileChange} className="block w-full text-sm text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-teal-700 file:text-white file:text-sm file:font-medium hover:file:bg-teal-600 cursor-pointer" />
          {csvErrors.length>0&&<div className="bg-red-900/20 border border-red-700/30 rounded-lg p-3 text-sm text-red-300 space-y-1">{csvErrors.slice(0,5).map((e,i)=><p key={i}>{e}</p>)}</div>}
          {csvRows.length>0&&<div><p className="text-sm text-green-400 mb-2">✓ {csvRows.length} rows ready</p><div className="max-h-40 overflow-y-auto text-xs bg-slate-700/30 rounded-lg p-3 space-y-1">{csvRows.slice(0,10).map((r,i)=><div key={i} className="flex gap-2 text-slate-300"><span className="font-mono text-teal-400">{r.part_number}</span><span className="truncate">{r.name}</span></div>)}</div></div>}
        </div>
      </Modal>

      {/* ── Image modal ──────────────────────────────────── */}
      {imageItem && (
        <ImageModal item={imageItem} onClose={()=>setImageItem(null)} onUpdate={handleMediaUpdate} />
      )}

      {/* ── Location modal ───────────────────────────────── */}
      {locItem && (
        <LocationModal item={locItem} onClose={()=>setLocItem(null)} onUpdate={handleMediaUpdate} />
      )}
    </div>
  )
}
