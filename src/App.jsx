import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import AuthPage from './components/AuthPage'
import CartProvider from './components/CartProvider'
import CatalogPage from './components/CatalogPage'
import FulfillmentPage from './components/FulfillmentPage'
import MyRequestsPage from './components/MyRequestsPage'
import RequestBoardPage from './components/RequestBoardPage'
import { useCart } from './hooks/useCart'

const navItems = [
  { key: 'catalog', label: 'קטלוג' },
  { key: 'board', label: 'בקשות פתוחות' },
  { key: 'my', label: 'הבקשות שלי' },
  { key: 'fulfillment', label: 'איסופים שלי' },
]

export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [activeTab, setActiveTab] = useState('catalog')

  const loadProfile = useCallback(async (user) => {
    if (!user) {
      setProfile(null)
      return
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, email')
      .eq('id', user.id)
      .maybeSingle()

    if (!error && data) {
      setProfile(data)
      return
    }

    const fallbackName = user.user_metadata?.display_name || user.email?.split('@')[0] || 'משתמש'
    const fallbackProfile = {
      id: user.id,
      display_name: fallbackName,
      email: user.email,
    }

    await supabase.from('profiles').upsert(fallbackProfile, { onConflict: 'id' })
    setProfile(fallbackProfile)
  }, [])

  useEffect(() => {
    let isActive = true

    supabase.auth.getSession().then(({ data }) => {
      if (!isActive) return
      const currentSession = data.session ?? null
      setSession(currentSession)
      loadProfile(currentSession?.user ?? null)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      loadProfile(nextSession?.user ?? null)
    })

    return () => {
      isActive = false
      data.subscription.unsubscribe()
    }
  }, [loadProfile])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    setActiveTab('catalog')
  }

  if (session === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-950 text-slate-100">
        <div className="rounded-lg border border-white/10 bg-white/5 px-5 py-4 text-sm">טוען...</div>
      </div>
    )
  }

  if (!session) return <AuthPage />

  return (
    <CartProvider key={session.user.id} userId={session.user.id}>
      <AppShell
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onSignOut={handleSignOut}
        profile={profile}
        user={session.user}
      />
    </CartProvider>
  )
}

function AppShell({ activeTab, onTabChange, onSignOut, profile, user }) {
  const { count } = useCart()
  const displayName = profile?.display_name || user.email

  const page = useMemo(() => {
    if (activeTab === 'board') {
      return <RequestBoardPage user={user} onClaimed={() => onTabChange('fulfillment')} />
    }
    if (activeTab === 'my') return <MyRequestsPage user={user} />
    if (activeTab === 'fulfillment') return <FulfillmentPage user={user} />
    return <CatalogPage user={user} onSubmitted={() => onTabChange('my')} />
  }, [activeTab, onTabChange, user])

  return (
    <div className="min-h-dvh bg-slate-100 text-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Groceries</p>
              <h1 className="text-xl font-bold text-slate-950">שלום {displayName}</h1>
            </div>
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
              onClick={onSignOut}
              type="button"
            >
              יציאה
            </button>
          </div>

          <nav className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {navItems.map((item) => (
              <button
                className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
                  activeTab === item.key
                    ? 'bg-emerald-700 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
                key={item.key}
                onClick={() => onTabChange(item.key)}
                type="button"
              >
                {item.label}
                {item.key === 'catalog' && count > 0 ? (
                  <span className="me-2 rounded-full bg-white/20 px-2 py-0.5 text-xs">{count}</span>
                ) : null}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{page}</main>
    </div>
  )
}
