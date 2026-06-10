import { useEffect } from 'react'

export default function TopNotice({ duration = 3200, notice, onDismiss }) {
  const text = typeof notice === 'string' ? notice : notice?.text
  const tone = typeof notice === 'string' ? 'success' : notice?.tone || 'success'

  useEffect(() => {
    if (!text || !onDismiss) return undefined
    const timeoutId = setTimeout(onDismiss, duration)
    return () => clearTimeout(timeoutId)
  }, [duration, onDismiss, text])

  if (!text) return null

  const toneClass =
    tone === 'error'
      ? 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-100 dark:ring-red-500/30'
      : 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-100 dark:ring-emerald-500/30'

  return (
    <div className="fixed inset-x-0 top-4 z-[80] px-4">
      <button
        className={`mx-auto block w-full max-w-md animate-[top-notice-pop_180ms_ease-out] rounded-xl p-3 text-center text-sm font-black shadow-2xl ring-1 backdrop-blur ${toneClass}`}
        onClick={onDismiss}
        type="button"
      >
        {text}
      </button>
    </div>
  )
}
