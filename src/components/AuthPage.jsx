import { useState } from 'react'
import { claimLegacyAccount, login, register } from '../lib/auth'

export default function AuthPage({ existingSession = null, onLogin }) {
  const [mode, setMode] = useState(existingSession ? 'setup' : 'login')
  const [username, setUsername] = useState(existingSession?.username || '')
  const [email, setEmail] = useState(existingSession?.is_admin ? 'yahavalon76@gmail.com' : '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [role, setRole] = useState('owner')
  const [familyName, setFamilyName] = useState(existingSession?.family_name || '')
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isRegister = mode === 'register'
  const isSetup = mode === 'setup'

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    if ((isRegister || isSetup) && password !== confirmPassword) {
      setError('הסיסמאות אינן זהות.')
      return
    }

    setLoading(true)
    const result = isSetup
      ? await claimLegacyAccount(existingSession, email, password)
      : isRegister
        ? await register({ email, familyName, inviteCode, password, role, username })
        : await login(username, password)
    setLoading(false)

    if (result.error) {
      setError(result.error)
      return
    }
    onLogin(result.session)
  }

  const valid = username.trim()
    && password.length >= (isRegister || isSetup ? 8 : 1)
    && (!isRegister && !isSetup || (email.trim() && confirmPassword.length >= 8))
    && (!isRegister || (role === 'owner' ? familyName.trim() : inviteCode.trim()))

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-950 px-4 py-8 text-white">
      <form className="w-full max-w-sm rounded-[1.35rem] border border-white/20 bg-white p-5 text-slate-950 shadow-2xl" onSubmit={handleSubmit}>
        <div className="mb-6">
          <p className="text-sm font-bold uppercase tracking-wide text-rose-700">רשימת קניות</p>
          <h1 className="mt-1 text-3xl font-black">
            {isSetup ? 'אבטחת החשבון' : isRegister ? 'יצירת משתמש' : 'כניסה'}
          </h1>
          {isSetup ? <p className="mt-2 text-sm text-slate-500">מוסיפים סיסמה לחשבון הקיים. הפעולה נדרשת פעם אחת.</p> : null}
        </div>

        <div className="space-y-3">
          <Field label="שם משתמש">
            <input
              autoComplete="username"
              autoFocus={!isSetup}
              className={inputClass}
              disabled={isSetup}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="שם משתמש"
              value={username}
            />
          </Field>

          {(isRegister || isSetup) ? (
            <Field label="אימייל">
              <input
                autoComplete="email"
                className={inputClass}
                disabled={isSetup && existingSession?.is_admin}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                type="email"
                value={email}
              />
            </Field>
          ) : null}

          <Field label="סיסמה">
            <input
              autoComplete={isRegister || isSetup ? 'new-password' : 'current-password'}
              className={inputClass}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={isRegister || isSetup ? 'לפחות 8 תווים' : 'סיסמה'}
              type="password"
              value={password}
            />
          </Field>

          {(isRegister || isSetup) ? (
            <Field label="אימות סיסמה">
              <input
                autoComplete="new-password"
                className={inputClass}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="הקלידו שוב"
                type="password"
                value={confirmPassword}
              />
            </Field>
          ) : null}

          {isRegister ? (
            <>
              <fieldset>
                <legend className="mb-2 text-sm font-bold text-slate-700">איך תשתמשו באפליקציה?</legend>
                <div className="grid grid-cols-2 gap-2">
                  <RoleButton active={role === 'owner'} label="ניהול הבית" onClick={() => setRole('owner')} />
                  <RoleButton active={role === 'shopper'} label="קונה" onClick={() => setRole('shopper')} />
                </div>
              </fieldset>

              {role === 'owner' ? (
                <Field label="שם המשפחה">
                  <input className={inputClass} onChange={(event) => setFamilyName(event.target.value)} placeholder="לדוגמה: משפחת אלון" value={familyName} />
                </Field>
              ) : (
                <Field label="קוד משפחה">
                  <input className={`${inputClass} uppercase`} dir="ltr" maxLength="8" onChange={(event) => setInviteCode(event.target.value.toUpperCase())} placeholder="XXXXXXXX" value={inviteCode} />
                </Field>
              )}
            </>
          ) : null}
        </div>

        {error ? <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div> : null}

        <button className="mt-5 h-12 w-full rounded-xl bg-rose-600 text-base font-black text-white disabled:opacity-60" disabled={loading || !valid} type="submit">
          {loading ? 'רק רגע...' : isSetup ? 'שמירה והמשך' : isRegister ? 'הרשמה' : 'כניסה'}
        </button>

        {!isSetup ? (
          <button
            className="mt-3 h-11 w-full rounded-xl bg-cyan-100 text-sm font-black text-cyan-950"
            onClick={() => {
              setMode(isRegister ? 'login' : 'register')
              setError('')
            }}
            type="button"
          >
            {isRegister ? 'כבר יש משתמש? כניסה' : 'משתמש חדש? הרשמה'}
          </button>
        ) : null}
      </form>
    </main>
  )
}

const inputClass = 'h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none transition focus:border-rose-600 focus:ring-4 focus:ring-rose-100 disabled:bg-slate-100 disabled:text-slate-500'

function Field({ children, label }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-bold text-slate-700">{label}</span>
      {children}
    </label>
  )
}

function RoleButton({ active, label, onClick }) {
  return (
    <button className={`h-12 rounded-xl font-black ${active ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-600'}`} onClick={onClick} type="button">
      {label}
    </button>
  )
}
