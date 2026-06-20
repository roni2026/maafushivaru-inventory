import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Search, X, Package, ArrowRight, Clock } from 'lucide-react'

const RECENT_KEY = 'om_recent_searches'
function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
}
function saveRecent(q) {
  try {
    const prev = getRecent().filter(x => x !== q)
    localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...prev].slice(0, 6)))
  } catch {}
}

export default function GlobalSearch({ isOpen, onClose }) {
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [recent,  setRecent]  = useState([])
  const inputRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (isOpen) {
      setQuery(''); setResults([])
      setRecent(getRecent())
      setTimeout(() => inputRef.current?.focus(), 60)
    }
  }, [isOpen])

  useEffect(() => {
    if (!query || query.length < 2) { setResults([]); return }
    setLoading(true)
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('items')
        .select('id, name, part_number, unit, current_stock, min_stock, expiry_date, stores(name)')
        .eq('active', true)
        .or(`name.ilike.%${query}%,part_number.ilike.%${query}%`)
        .order('name').limit(12)
      setResults(data || [])
      setLoading(false)
    }, 220)
    return () => { clearTimeout(t); setLoading(false) }
  }, [query])

  const go = (item) => {
    saveRecent(item.name)
    navigate('/inventory')
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-slate-800 border border-slate-600 rounded-2xl shadow-2xl overflow-hidden">

        {/* Input row */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-700">
          <Search className="w-5 h-5 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search by item name or part number…"
            className="flex-1 bg-transparent text-slate-100 placeholder-slate-500 text-base focus:outline-none"
          />
          {query ? (
            <button onClick={() => setQuery('')} className="text-slate-500 hover:text-slate-300 transition-colors">
              <X className="w-5 h-5" />
            </button>
          ) : null}
          <button onClick={onClose}
            className="hidden sm:flex items-center gap-1 text-xs text-slate-500 bg-slate-700 px-2 py-1.5 rounded-lg hover:bg-slate-600 transition-colors">
            ESC
          </button>
        </div>

        {/* Results / empty / recent */}
        <div className="max-h-[65vh] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="w-7 h-7 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : results.length > 0 ? (
            <>
              <div className="px-5 py-2 border-b border-slate-700/40">
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">{results.length} result{results.length !== 1 ? 's' : ''}</p>
              </div>
              {results.map(item => {
                const isLow = Number(item.current_stock) <= Number(item.min_stock)
                return (
                  <button key={item.id} onClick={() => go(item)}
                    className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-slate-700/50 transition-colors text-left border-b border-slate-700/30">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isLow ? 'bg-red-900/50' : 'bg-teal-900/50'}`}>
                      <Package className={`w-4 h-4 ${isLow ? 'text-red-400' : 'text-teal-400'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-100 truncate">{item.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {item.part_number} · {item.stores?.name}
                        <span className={`ml-2 font-medium ${isLow ? 'text-red-400' : 'text-teal-400'}`}>
                          {item.current_stock} {item.unit}
                        </span>
                        {item.expiry_date && <span className="ml-2 text-slate-500">· Exp {item.expiry_date}</span>}
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-600 shrink-0" />
                  </button>
                )
              })}
            </>
          ) : query.length >= 2 ? (
            <div className="text-center py-12 text-slate-500">
              <Search className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">No items found for "{query}"</p>
              <p className="text-xs mt-1">Try a different name or part number.</p>
            </div>
          ) : (
            <div className="px-5 py-5">
              {recent.length > 0 && (
                <div className="mb-5">
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-2">Recent Searches</p>
                  <div className="flex gap-2 flex-wrap">
                    {recent.map(r => (
                      <button key={r} onClick={() => setQuery(r)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs text-slate-300 transition-colors">
                        <Clock className="w-3.5 h-3.5 text-slate-500" />{r}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-sm font-medium text-slate-400 mb-3">Tips</p>
              <ul className="space-y-2 text-xs text-slate-500">
                <li className="flex gap-2">
                  <span>→</span>Type at least 2 characters to search items
                </li>
                <li className="flex gap-2">
                  <span>→</span>Search by item name or part number
                </li>
                <li className="flex gap-2">
                  <span>→</span>Press <kbd className="bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded text-xs mx-1">Ctrl+K</kbd> to open this anywhere
                </li>
                <li className="flex gap-2">
                  <span>→</span>Press <kbd className="bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded text-xs mx-1">ESC</kbd> to close
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
