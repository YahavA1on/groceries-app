import { useEffect, useMemo, useState } from 'react'
import AuthPage from './components/AuthPage'
import CartProvider from './components/CartProvider'
import CatalogPage from './components/CatalogPage'
import FulfillmentPage from './components/FulfillmentPage'
import InventoryPage from './components/InventoryPage'
import MyRequestsPage from './components/MyRequestsPage'
import PushNotificationPrompt from './components/PushNotificationPrompt'
import ProfileSheet from './components/ProfileSheet'
import ReceiptImportPage from './components/ReceiptImportPage'
import { getCurrentSession, logout, refreshCurrentSession, saveSession } from './lib/auth'
import { useCart } from './hooks/useCart'
import { supabase } from './lib/supabase'

const ownerTabs = [
  { key: 'catalog', label: 'הוספה' },
  { key: 'my', label: 'רשימה' },
  { key: 'inventory', label: 'מלאי' },
]

const shopperTabs = [
  { key: 'fulfillment', label: 'קנייה' },
  { key: 'catalog', label: 'הוספה' },
  { key: 'inventory', label: 'מלאי' },
]

export default function App() {
  const [initialSession] = useState(() => getCurrentSession())
  const [session, setSession] = useState(initialSession)
  const [checkingSession, setCheckingSession] = useState(Boolean(initialSession))
  const [activeTab, setActiveTab] = useState(session?.role === 'shopper' ? 'fulfillment' : 'catalog')
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('groceries_theme') === 'dark')

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    localStorage.setItem('groceries_theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  useEffect(() => {
    if (!initialSession) return undefined

    let cancelled = false
    refreshCurrentSession().then((refreshed) => {
      if (cancelled) return
      setSession(refreshed)
      setCheckingSession(false)
      if (refreshed?.role === 'shopper') setActiveTab('fulfillment')
    })
    return () => {
      cancelled = true
    }
  }, [initialSession])

  async function handleLogout() {
    await logout()
    setSession(null)
    setActiveTab('catalog')
  }

  function handleLogin(nextSession) {
    setSession(nextSession)
    setActiveTab(nextSession.role === 'shopper' ? 'fulfillment' : 'catalog')
  }

  function handleSessionChange(nextSession) {
    setSession(saveSession(nextSession))
  }

  if (checkingSession) return <div className="flex min-h-dvh items-center justify-center bg-slate-950 text-lg font-black text-white">בודק חיבור...</div>
  if (!session || session.needs_password_setup) return <AuthPage existingSession={session?.needs_password_setup ? session : null} onLogin={handleLogin} />

  return (
    <CartProvider key={session.user_id} userId={session.user_id}>
      <AppShell
        activeTab={activeTab}
        darkMode={darkMode}
        onLogout={handleLogout}
        onSessionChange={handleSessionChange}
        onTabChange={setActiveTab}
        onToggleTheme={() => setDarkMode((value) => !value)}
        session={session}
      />
    </CartProvider>
  )
}

function AppShell({ activeTab, darkMode, onLogout, onSessionChange, onTabChange, onToggleTheme, session }) {
  const { count } = useCart()
  const tabs = session.role === 'shopper' ? shopperTabs : ownerTabs
  const [familyDetails, setFamilyDetails] = useState(null)
  const [profileOpen, setProfileOpen] = useState(false)

  useEffect(() => {
    if (!session.family_id) return undefined
    let cancelled = false
    supabase.rpc('get_family_details', { p_session_token: session.token }).then(({ data }) => {
      if (!cancelled && data) setFamilyDetails(data)
    })
    return () => {
      cancelled = true
    }
  }, [session.family_id, session.family_name, session.token])

  const page = useMemo(() => {
    if (activeTab === 'my') return <MyRequestsPage session={session} />
    if (activeTab === 'fulfillment') return <FulfillmentPage session={session} />
    if (activeTab === 'inventory') return <InventoryPage session={session} />
    if (activeTab === 'receipt') return <ReceiptImportPage session={session} />
    return <CatalogPage session={session} onSubmitted={() => onTabChange('my')} />
  }, [activeTab, onTabChange, session])

  return (
    <div className="min-h-dvh bg-orange-50 pb-28 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-30 border-b border-rose-100 bg-orange-50/95 px-4 py-3 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button aria-label="פרופיל" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-base font-black text-rose-800 dark:bg-rose-500/20 dark:text-rose-100" onClick={() => setProfileOpen(true)} title="פרופיל" type="button">
              {session.username?.trim()?.[0] || 'א'}
            </button>
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-wide text-rose-700 dark:text-cyan-300">רשימת קניות</p>
              <h1 className="truncate text-xl font-black">שלום {session.username}</h1>
              <p className="truncate text-xs font-bold text-slate-500 dark:text-slate-400">
                {familyDetails?.name || session.family_name}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {session.member_role === 'manager' || session.is_admin ? <button
              aria-label="סריקת קבלה"
              className={`flex h-10 w-10 items-center justify-center rounded-xl text-slate-950 transition dark:text-slate-100 ${
                activeTab === 'receipt'
                  ? 'bg-rose-600 text-white dark:bg-cyan-400 dark:text-slate-950'
                  : 'bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-200'
              }`}
              onClick={() => onTabChange('receipt')}
              title="סריקת קבלה"
              type="button"
            >
              <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" viewBox="0 0 24 24">
                <path d="M3 4h2l2.3 11.4a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 1.9-1.4L21 8H7" />
                <path d="M10 21h.01" />
                <path d="M18 21h.01" />
              </svg>
            </button> : null}
            <button
              className="h-10 min-w-10 rounded-xl bg-indigo-100 px-3 text-lg font-black text-indigo-950 dark:bg-indigo-500/20 dark:text-indigo-100"
              onClick={onToggleTheme}
              title={darkMode ? 'מצב בהיר' : 'מצב כהה'}
              type="button"
            >
              {darkMode ? '☀' : '☾'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 py-4">{page}</main>

      <nav aria-label="Main navigation">
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-rose-100 bg-orange-50/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-10px_30px_rgba(15,23,42,0.12)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
          <div className={`mx-auto grid max-w-md gap-2 ${tabs.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
            {tabs.map((tab) => (
              <button
                className={`relative rounded-2xl px-2 py-3 text-sm font-black transition active:scale-[0.98] ${
                  activeTab === tab.key
                    ? 'bg-rose-600 text-white shadow-lg shadow-rose-900/20 dark:bg-cyan-400 dark:text-slate-950'
                    : 'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                }`}
                key={tab.key}
                onClick={() => onTabChange(tab.key)}
                type="button"
              >
                {tab.label}
                {tab.key === 'catalog' && count > 0 ? (
                  <span className="absolute -top-1 end-2 rounded-full bg-cyan-300 px-2 py-0.5 text-xs text-slate-950">{count}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {profileOpen ? (
        <ProfileSheet
          onClose={() => setProfileOpen(false)}
          familyCode={familyDetails?.invite_code}
          onLogout={onLogout}
          onSessionChange={onSessionChange}
          session={session}
        />
      ) : null}
      <PushNotificationPrompt session={session} />
    </div>
  )
}
