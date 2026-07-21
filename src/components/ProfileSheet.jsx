import { useState } from 'react'
import { changePassword, updateProfile } from '../lib/auth'
import PushNotificationSettings from './PushNotificationSettings'

const FAMILY_PREFIX = 'הבית של משפחת '

export default function ProfileSheet({ familyCode, onClose, onLogout, onSessionChange, session }) {
  const canRenameFamily = Boolean(session.family_id) && (session.member_role === 'manager' || session.is_admin)
  const initialSurname = session.family_name?.startsWith(FAMILY_PREFIX)
    ? session.family_name.slice(FAMILY_PREFIX.length)
    : ''
  const [username, setUsername] = useState(session.username || '')
  const [familySurname, setFamilySurname] = useState(initialSurname)
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileMessage, setProfileMessage] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState('')

  async function saveProfile(event) {
    event.preventDefault()
    setProfileMessage('')
    setProfileBusy(true)
    const surname = canRenameFamily && familySurname.trim() ? familySurname : null
    const result = await updateProfile(session, username, surname)
    setProfileBusy(false)
    if (result.error) {
      setProfileMessage(result.error)
      return
    }
    onSessionChange(result.session)
    setProfileMessage('הפרופיל נשמר.')
  }

  async function savePassword(event) {
    event.preventDefault()
    setPasswordMessage('')
    if (newPassword !== confirmPassword) {
      setPasswordMessage('הסיסמאות אינן זהות.')
      return
    }
    setPasswordBusy(true)
    const result = await changePassword(session, currentPassword, newPassword)
    setPasswordBusy(false)
    if (result.error) {
      setPasswordMessage(result.error)
      return
    }
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPasswordMessage('הסיסמה שונתה. חיבורים במכשירים אחרים נותקו.')
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end bg-slate-950/60 sm:items-center sm:justify-center" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-label="פרופיל" className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[1.75rem] bg-orange-50 p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-slate-950 shadow-2xl dark:bg-slate-900 dark:text-white sm:max-w-md sm:rounded-[1.75rem]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-black text-rose-700 dark:text-cyan-300">החשבון שלי</p>
            <h2 className="text-2xl font-black">פרופיל</h2>
          </div>
          <button aria-label="סגירה" className="h-10 w-10 rounded-xl bg-white text-xl font-black dark:bg-slate-800" onClick={onClose} type="button">×</button>
        </div>

        <form className="space-y-3 rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-800" onSubmit={saveProfile}>
          <h3 className="font-black">פרטים</h3>
          <Field label="כינוי">
            <input className={inputClass} maxLength="40" onChange={(event) => setUsername(event.target.value)} value={username} />
          </Field>
          {canRenameFamily ? (
            <>
              <Field label="שם המשפחה">
                <input className={inputClass} maxLength="60" onChange={(event) => setFamilySurname(event.target.value)} placeholder="לדוגמה: אלון" value={familySurname} />
                <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">יוצג כ״הבית של משפחת {familySurname || '...'}״ לכל בני הבית.</span>
              </Field>
              {familyCode ? (
                <div className="rounded-xl bg-cyan-50 p-3 dark:bg-cyan-400/10">
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400">קוד המשפחה</p>
                  <p className="mt-1 select-all font-mono text-xl font-black text-cyan-900 dark:text-cyan-200" dir="ltr">{familyCode}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">שתפו אותו רק עם קונה שצריך להצטרף לבית.</p>
                </div>
              ) : null}
            </>
          ) : null}
          <Message text={profileMessage} />
          <button className={primaryButton} disabled={profileBusy || username.trim().length < 2} type="submit">{profileBusy ? 'שומר...' : 'שמירת פרטים'}</button>
        </form>

        <form className="mt-3 space-y-3 rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-800" onSubmit={savePassword}>
          <h3 className="font-black">שינוי סיסמה</h3>
          <Field label="סיסמה נוכחית"><input autoComplete="current-password" className={inputClass} onChange={(event) => setCurrentPassword(event.target.value)} type="password" value={currentPassword} /></Field>
          <Field label="סיסמה חדשה"><input autoComplete="new-password" className={inputClass} minLength="8" onChange={(event) => setNewPassword(event.target.value)} type="password" value={newPassword} /></Field>
          <Field label="אימות סיסמה"><input autoComplete="new-password" className={inputClass} minLength="8" onChange={(event) => setConfirmPassword(event.target.value)} type="password" value={confirmPassword} /></Field>
          <Message text={passwordMessage} />
          <button className={primaryButton} disabled={passwordBusy || !currentPassword || newPassword.length < 8 || confirmPassword.length < 8} type="submit">{passwordBusy ? 'משנה...' : 'שינוי סיסמה'}</button>
        </form>

        {session.family_id ? <PushNotificationSettings session={session} /> : null}

        <button className="mt-4 h-12 w-full rounded-xl bg-rose-100 font-black text-rose-800 dark:bg-rose-500/20 dark:text-rose-100" onClick={onLogout} type="button">יציאה מהחשבון</button>
      </section>
    </div>
  )
}

const inputClass = 'h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-rose-600 focus:ring-4 focus:ring-rose-100 dark:border-slate-600 dark:bg-slate-950 dark:text-white dark:focus:ring-cyan-900'
const primaryButton = 'h-11 w-full rounded-xl bg-rose-600 font-black text-white disabled:opacity-50 dark:bg-cyan-400 dark:text-slate-950'

function Field({ children, label }) {
  return <label className="block"><span className="mb-1 block text-sm font-bold">{label}</span>{children}</label>
}

function Message({ text }) {
  if (!text) return null
  const success = text.includes('נשמר') || text.includes('שונתה')
  return <p className={`rounded-xl p-3 text-sm font-bold ${success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{text}</p>
}
