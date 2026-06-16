import { useState } from 'react'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'

export default function Layout({ children, session }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <Sidebar session={session} isOpen={open} onClose={() => setOpen(false)} />

      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile topbar */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 bg-slate-800 border-b border-slate-700 shrink-0">
          <button
            onClick={() => setOpen(true)}
            className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
          >
            <Menu className="w-5 h-5 text-slate-400" />
          </button>
          <span className="font-display text-lg font-semibold text-teal-400">Outrigger Inventory</span>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
