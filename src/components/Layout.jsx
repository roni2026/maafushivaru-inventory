import { useState, useEffect } from 'react'
import { Menu, Sun, Moon, Search as SearchIcon } from 'lucide-react'
import Sidebar          from './Sidebar'
import NotificationBell from './NotificationBell'
import GlobalSearch     from './GlobalSearch'
import { useTheme }     from '../hooks/useTheme'

export default function Layout({ children, session }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchOpen,  setSearchOpen]  = useState(false)
  const { isDark, toggle }            = useTheme()

  // Ctrl+K / Cmd+K → open global search
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(s => !s)
      }
      if (e.key === 'Escape') setSearchOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <Sidebar session={session} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Top header */}
        <header className="flex items-center gap-3 px-4 py-3 bg-slate-800 border-b border-slate-700 shrink-0">
          {/* Mobile: hamburger */}
          <button onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 hover:bg-slate-700 rounded-lg transition-colors">
            <Menu className="w-5 h-5 text-slate-400" />
          </button>

          {/* Mobile: brand title */}
          <span className="lg:hidden font-display text-base font-semibold text-teal-400 flex-1 truncate">
            Outrigger Inventory
          </span>

          {/* Desktop: search bar */}
          <button onClick={() => setSearchOpen(true)}
            className="hidden lg:flex items-center gap-2 flex-1 max-w-md bg-slate-700/60 hover:bg-slate-700 border border-slate-600/60 rounded-xl px-4 py-2 text-slate-400 hover:text-slate-200 transition-colors text-sm">
            <SearchIcon className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left">Search items by name or part number…</span>
            <kbd className="text-xs bg-slate-600 px-2 py-0.5 rounded-md shrink-0">Ctrl+K</kbd>
          </button>

          {/* Push remaining actions to the right (desktop) */}
          <div className="hidden lg:flex flex-1" />

          {/* Right side: mobile search + theme + bell */}
          <div className="flex items-center gap-1">
            {/* Mobile: search icon */}
            <button onClick={() => setSearchOpen(true)}
              className="lg:hidden p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400">
              <SearchIcon className="w-5 h-5" />
            </button>

            {/* Theme toggle */}
            <button onClick={toggle}
              className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-slate-100"
              title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}>
              {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>

            {/* Notification bell */}
            <NotificationBell />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6 bg-slate-900">
          {children}
        </main>
      </div>

      {/* Global search modal */}
      <GlobalSearch isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
