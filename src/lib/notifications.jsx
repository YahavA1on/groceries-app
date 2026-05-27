import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const NotificationsContext = createContext(null)

export function NotificationsProvider({ children }) {
  const [notifications, setNotifications] = useState([])

  const notify = useCallback((message, type = 'success', duration = 3200) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setNotifications((prev) => [...prev, { id, message, type }])

    window.setTimeout(() => {
      setNotifications((prev) => prev.filter((item) => item.id !== id))
    }, duration)
  }, [])

  const value = useMemo(() => ({
    notify,
    notifySuccess: (message, duration) => notify(message, 'success', duration),
    notifyError: (message, duration) => notify(message, 'error', duration),
  }), [notify])

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <div className="top-notifications" aria-live="polite" aria-atomic="false">
        {notifications.map((item) => (
          <div
            key={item.id}
            className={`top-notification ${item.type === 'error' ? 'error' : 'success'}`}
          >
            {item.message}
          </div>
        ))}
      </div>
    </NotificationsContext.Provider>
  )
}

export function useNotifications() {
  const context = useContext(NotificationsContext)
  if (!context) {
    throw new Error('useNotifications must be used inside NotificationsProvider')
  }
  return context
}
