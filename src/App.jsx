import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import Layout       from './components/Layout'
import Dashboard    from './pages/Dashboard'
import Inventory    from './pages/Inventory'
import Issuance     from './pages/Issuance'
import Reports      from './pages/Reports'
import Orders       from './pages/Orders'
import Analytics    from './pages/Analytics'
import Settings     from './pages/Settings'
import Login        from './pages/Login'
import StockHistory from './pages/StockHistory'
import Waste        from './pages/Waste'
import Stocktake    from './pages/Stocktake'
import Transfers    from './pages/Transfers'
import Suppliers    from './pages/Suppliers'
import ItemDetail   from './pages/ItemDetail'
import Receiving    from './pages/Receiving'

function ProtectedRoute({ session, children }) {
  if (!session) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          style:   { background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155' },
          success: { iconTheme: { primary: '#14b8a6', secondary: '#f1f5f9' } },
          error:   { iconTheme: { primary: '#ef4444', secondary: '#f1f5f9' } },
        }}
      />
      <Routes>
        <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/*" element={
          <ProtectedRoute session={session}>
            <Layout session={session}>
              <Routes>
                <Route index              element={<Dashboard />}    />
                <Route path="inventory"   element={<Inventory />}    />
                <Route path="inventory/:id" element={<ItemDetail />} />
                <Route path="issuance"    element={<Issuance />}     />
                <Route path="reports"     element={<Reports />}      />
                <Route path="orders"      element={<Orders />}       />
                <Route path="analytics"   element={<Analytics />}    />
                <Route path="settings"    element={<Settings />}     />
                <Route path="history"     element={<StockHistory />} />
                <Route path="waste"       element={<Waste />}        />
                <Route path="stocktake"   element={<Stocktake />}    />
                <Route path="transfers"   element={<Transfers />}    />
                <Route path="suppliers"   element={<Suppliers />}    />
                <Route path="receiving"   element={<Receiving />}    />
              </Routes>
            </Layout>
          </ProtectedRoute>
        } />
      </Routes>
    </BrowserRouter>
  )
}
