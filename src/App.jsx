import { useEffect, useState } from 'react'
import { getCurrentSession, logout } from './lib/auth'
import { initTheme } from './lib/theme'
import LoginScreen from './components/LoginScreen'
import OwnerHome from './components/OwnerHome'
import ShopperHome from './components/ShopperHome'

export default function App() {
  const [session, setSession] = useState(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    initTheme()
    setSession(getCurrentSession())
    setLoaded(true)
  }, [])

  const handleLogout = async () => {
    await logout()
    setSession(null)
  }

  if (!loaded) return null
  if (!session) return <LoginScreen onLogin={setSession} />

  if (session.role === 'shopper') {
    return <ShopperHome session={session} onLogout={handleLogout} />
  }
  return <OwnerHome session={session} onLogout={handleLogout} />
}