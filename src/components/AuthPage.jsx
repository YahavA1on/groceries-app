import { useState } from 'react'
import { login, register } from '../lib/auth'

export default function AuthPage({ onLogin }) {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const isRegister = mode === 'register'

  async function handleSubmit(event) {
    event.preventDefault()
    setLoading(true)
    setError('')

    const result = isRegister ? await register(username) : await login(username)
    setLoading(false)

    if (result.error) {
      setError(result.error)
      return
    }

    onLogin(result.session)
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-950 px-4 py-8 text-white">
      <form className="w-full max-w-sm rounded-[1.35rem] border border-white/20 bg-white p-5 text-slate-950 shadow-2xl" onSubmit={handleSubmit}>
        <div className="mb-6">
          <p className="text-sm font-bold uppercase tracking-wide text-rose-700">רשימת קניות</p>
          <h1 className="mt-1 text-3xl font-black">{isRegister ? 'הרשמה מהירה' : 'כניסה למערכת'}</h1>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-bold text-slate-700">שם משתמש</span>
          <input
            autoFocus
            className="h-12 w-full rounded-xl border border-slate-300 px-3 text-lg outline-none transition focus:border-rose-600 focus:ring-4 focus:ring-rose-100"
            onChange={(event) => setUsername(event.target.value)}
            placeholder="שם משתמש"
            type="text"
            value={username}
          />
        </label>

        {error ? <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div> : null}

        <button
          className="mt-5 h-12 w-full rounded-xl bg-rose-600 text-base font-black text-white transition active:scale-[0.99] disabled:opacity-60"
          disabled={loading || !username.trim()}
          type="submit"
        >
          {loading ? 'רק רגע...' : isRegister ? 'יצירת משתמש' : 'כניסה'}
        </button>

        <button
          className="mt-3 h-11 w-full rounded-xl bg-cyan-100 text-sm font-black text-cyan-950 transition active:scale-[0.99]"
          onClick={() => {
            setMode(isRegister ? 'login' : 'register')
            setError('')
          }}
          type="button"
        >
          {isRegister ? 'כבר יש משתמש? כניסה' : 'משתמש חדש? הרשמה'}
        </button>
      </form>
    </main>
  )
}
