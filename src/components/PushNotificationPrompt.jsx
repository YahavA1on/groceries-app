import { useEffect, useState } from 'react'
import { enablePushNotifications, getPushSubscription, hasAnsweredPushPrompt, pushCapability, rememberPushPromptChoice } from '../lib/pushNotifications'
import { userErrorMessage } from '../lib/userErrors'

export default function PushNotificationPrompt({ session }) {
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const capability = pushCapability()
    if (!capability.supported || hasAnsweredPushPrompt(session)) return undefined
    if (Notification.permission === 'denied') {
      rememberPushPromptChoice(session, 'denied')
      return undefined
    }

    let cancelled = false
    getPushSubscription()
      .then((subscription) => {
        if (cancelled) return
        if (subscription) rememberPushPromptChoice(session, 'enabled')
        else setVisible(true)
      })
      .catch(() => {})

    const hidePrompt = () => setVisible(false)
    window.addEventListener('groceries:push-choice', hidePrompt)
    return () => {
      cancelled = true
      window.removeEventListener('groceries:push-choice', hidePrompt)
    }
  }, [session])

  function dismiss() {
    rememberPushPromptChoice(session, 'later')
    setVisible(false)
  }

  async function enable() {
    setBusy(true)
    setMessage('')
    try {
      await enablePushNotifications(session)
      setVisible(false)
    } catch (error) {
      setMessage(userErrorMessage(error, 'לא ניתן להפעיל התראות כרגע.'))
      if (Notification.permission === 'denied') rememberPushPromptChoice(session, 'denied')
    } finally {
      setBusy(false)
    }
  }

  if (!visible) return null

  return (
    <aside className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[60] mx-auto max-w-md rounded-2xl border border-rose-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900" role="dialog" aria-label="הפעלת התראות">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-100 text-xl dark:bg-cyan-400/20">🔔</span>
        <div className="min-w-0">
          <h2 className="font-black">רוצים לקבל התראות?</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">נעדכן כשנוספו בקשות וכשמוצרים מהרשימה נקנו.</p>
        </div>
      </div>
      {message ? <p className="mt-3 rounded-xl bg-red-50 p-2 text-sm font-bold text-red-700 dark:bg-red-500/10 dark:text-red-200">{message}</p> : null}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button className="h-11 rounded-xl bg-slate-100 font-black text-slate-700 dark:bg-slate-800 dark:text-slate-200" disabled={busy} onClick={dismiss} type="button">לא עכשיו</button>
        <button className="h-11 rounded-xl bg-rose-600 font-black text-white disabled:opacity-50 dark:bg-cyan-400 dark:text-slate-950" disabled={busy} onClick={enable} type="button">{busy ? 'מפעיל...' : 'הפעלת התראות'}</button>
      </div>
    </aside>
  )
}
