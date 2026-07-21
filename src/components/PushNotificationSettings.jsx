import { useEffect, useState } from 'react'
import { disablePushNotifications, enablePushNotifications, getPushSubscription, pushCapability } from '../lib/pushNotifications'
import { userErrorMessage } from '../lib/userErrors'

export default function PushNotificationSettings({ session }) {
  const capability = pushCapability()
  const [enabled, setEnabled] = useState(false)
  const [checking, setChecking] = useState(capability.supported)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!capability.supported) return undefined
    let cancelled = false
    const syncChoice = (event) => setEnabled(event.detail?.choice === 'enabled')
    window.addEventListener('groceries:push-choice', syncChoice)
    getPushSubscription()
      .then((subscription) => {
        if (!cancelled) setEnabled(Boolean(subscription))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
      window.removeEventListener('groceries:push-choice', syncChoice)
    }
  }, [capability.supported])

  async function toggleNotifications() {
    setBusy(true)
    setMessage('')
    try {
      if (enabled) {
        await disablePushNotifications(session)
        setEnabled(false)
        setMessage('ההתראות כובו במכשיר הזה.')
      } else {
        await enablePushNotifications(session)
        setEnabled(true)
        setMessage('ההתראות הופעלו במכשיר הזה.')
      }
    } catch (error) {
      setMessage(userErrorMessage(error, 'לא ניתן לעדכן את ההתראות.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-3 rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-800">
      <h3 className="font-black">התראות לטלפון</h3>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">קבלו התראה כשנוספו בקשות וכשהקונה סיים לקנות מוצרים.</p>
      {!capability.supported ? (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">{capability.reason}</p>
      ) : (
        <button aria-pressed={enabled} className={`mt-3 h-11 w-full rounded-xl font-black disabled:opacity-50 ${enabled ? 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100' : 'bg-rose-600 text-white dark:bg-cyan-400 dark:text-slate-950'}`} disabled={busy || checking} onClick={toggleNotifications} type="button">
          {checking ? 'בודק...' : busy ? 'מעדכן...' : enabled ? 'כיבוי התראות במכשיר' : 'הפעלת התראות במכשיר'}
        </button>
      )}
      {message ? <p className="mt-2 text-sm font-bold text-slate-600 dark:text-slate-300">{message}</p> : null}
    </section>
  )
}
