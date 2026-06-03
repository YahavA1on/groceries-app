import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function AuthPage() {
  const [mode, setMode] = useState('signin')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const isSignup = mode === 'signup'

  const handleSubmit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')

    const normalizedEmail = email.trim().toLowerCase()
    const cleanName = displayName.trim() || normalizedEmail.split('@')[0]

    const result = isSignup
      ? await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: { data: { display_name: cleanName } },
        })
      : await supabase.auth.signInWithPassword({ email: normalizedEmail, password })

    setBusy(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    if (isSignup && !result.data.session) {
      setMessage('נרשמת בהצלחה. בדקו את תיבת המייל כדי לאשר את החשבון.')
    }
  }

  return (
    <div className="grid min-h-dvh bg-slate-950 text-slate-100 lg:grid-cols-[1fr_420px]">
      <section className="relative hidden overflow-hidden lg:block">
        <img
          alt=""
          className="h-full w-full object-cover opacity-80"
          src={`${import.meta.env.BASE_URL}rami.jpg`}
        />
        <div className="absolute inset-0 bg-gradient-to-l from-slate-950 via-slate-950/45 to-transparent" />
        <div className="absolute bottom-12 right-12 max-w-lg">
          <h1 className="text-5xl font-bold leading-tight">בקשות קניה, במקום אחד.</h1>
          <p className="mt-4 text-lg text-slate-200">
            קטלוג מוצרים משותף, בקשות פתוחות, ואיסוף בזמן אמת בין משתמשים.
          </p>
        </div>
      </section>

      <section className="flex items-center justify-center px-4 py-8">
        <form
          className="w-full max-w-md rounded-lg border border-white/10 bg-white p-6 text-slate-950 shadow-2xl"
          onSubmit={handleSubmit}
        >
          <div className="mb-6">
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Groceries</p>
            <h2 className="mt-1 text-2xl font-bold">{isSignup ? 'הרשמה' : 'כניסה'}</h2>
          </div>

          {isSignup ? (
            <label className="mb-4 block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">שם לתצוגה</span>
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-base outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="למשל: דנה"
                type="text"
                value={displayName}
              />
            </label>
          ) : null}

          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">אימייל</span>
            <input
              autoComplete="email"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-left text-base outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              dir="ltr"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>

          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">סיסמה</span>
            <input
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-left text-base outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              dir="ltr"
              minLength={6}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>

          {error ? (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          ) : null}
          {message ? (
            <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {message}
            </div>
          ) : null}

          <button
            className="w-full rounded-md bg-emerald-700 px-4 py-2.5 font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy}
            type="submit"
          >
            {busy ? 'טוען...' : isSignup ? 'יצירת חשבון' : 'כניסה'}
          </button>

          <button
            className="mt-3 w-full rounded-md px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
            onClick={() => {
              setMode(isSignup ? 'signin' : 'signup')
              setError('')
              setMessage('')
            }}
            type="button"
          >
            {isSignup ? 'כבר יש חשבון? כניסה' : 'אין חשבון? הרשמה'}
          </button>
        </form>
      </section>
    </div>
  )
}
