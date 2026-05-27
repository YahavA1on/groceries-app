import { useEffect, useState } from 'react'
import { getCurrentSession, logout } from './lib/auth'
import { initTheme } from './lib/theme'
import { NotificationsProvider } from './lib/notifications'
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

  return (
    <NotificationsProvider>
      {!loaded ? null : !session ? (
        <LoginScreen onLogin={setSession} />
      ) : session.role === 'shopper' ? (
        <ShopperHome session={session} onLogout={handleLogout} />
      ) : (
        <OwnerHome session={session} onLogout={handleLogout} />
      )}
    </NotificationsProvider>
  )
}