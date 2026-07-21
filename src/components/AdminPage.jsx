import { useCallback, useEffect, useMemo, useState } from 'react'
import TopNotice from './TopNotice'
import { deleteAdminFamily, deleteAdminUser, fetchAdminDashboard, selectAdminFamily, updateAdminUser } from '../lib/adminData'
import { refreshCurrentSession } from '../lib/auth'
import { replaceStateWhenChanged } from '../lib/stateUpdates'
import { userErrorMessage } from '../lib/userErrors'

const activityTypes = [
  { key: 'all', label: 'הכול' },
  { key: 'shopping', label: 'רשימות' },
  { key: 'inventory', label: 'מלאי' },
  { key: 'accounts', label: 'חשבונות' },
  { key: 'catalog', label: 'מוצרים' },
]

const activityPeriods = [
  { key: 'week', label: 'שבוע' },
  { key: 'month', label: 'חודש' },
  { key: 'all', label: 'כל הזמן' },
]

export default function AdminPage({ onSessionChange, session }) {
  const [summary, setSummary] = useState({})
  const [families, setFamilies] = useState([])
  const [activity, setActivity] = useState([])
  const [users, setUsers] = useState([])
  const [familyId, setFamilyId] = useState('')
  const [activityType, setActivityType] = useState('all')
  const [activityPeriod, setActivityPeriod] = useState('week')
  const [viewFamilyId, setViewFamilyId] = useState(session.admin_family_id || '')
  const [switchingFamily, setSwitchingFamily] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [userFamilyId, setUserFamilyId] = useState('')
  const [deletingUserId, setDeletingUserId] = useState('')
  const [deletingFamilyId, setDeletingFamilyId] = useState('')
  const [editingUser, setEditingUser] = useState(null)
  const [savingUser, setSavingUser] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const loadDashboard = useCallback(async () => {
    const result = await fetchAdminDashboard(session, familyId, activityPeriod)
    if (result.error) {
      setError(userErrorMessage(result.error))
    } else {
      setError('')
      replaceStateWhenChanged(setSummary, result.data.summary)
      replaceStateWhenChanged(setFamilies, result.data.families)
      replaceStateWhenChanged(setActivity, result.data.activity)
      replaceStateWhenChanged(setUsers, result.data.users)
    }
    setLoading(false)
  }, [activityPeriod, familyId, session])

  useEffect(() => {
    const timeoutId = setTimeout(loadDashboard, 0)
    const intervalId = setInterval(loadDashboard, 15_000)
    return () => {
      clearTimeout(timeoutId)
      clearInterval(intervalId)
    }
  }, [loadDashboard])

  const visibleActivity = useMemo(
    () => activity.filter((item) => activityType === 'all' || activityGroup(item.entity_type) === activityType),
    [activity, activityType]
  )
  const visibleUsers = useMemo(() => {
    const needle = userSearch.trim().toLocaleLowerCase('he')
    return users.filter((user) => (
      (!userFamilyId || (userFamilyId === '__none' ? !user.family_id : user.family_id === userFamilyId))
      && (!needle || `${user.username} ${user.email || ''} ${user.family_name || ''}`.toLocaleLowerCase('he').includes(needle))
    ))
  }, [userFamilyId, userSearch, users])

  async function changeFamilyView(nextFamilyId) {
    setSwitchingFamily(true)
    const result = await selectAdminFamily(session, nextFamilyId)
    setSwitchingFamily(false)
    if (result.error) {
      setError(userErrorMessage(result.error))
      return
    }
    setViewFamilyId(nextFamilyId || '')
    onSessionChange(result.data)
  }

  async function deleteUser(user) {
    const typedName = window.prompt(`למחיקת המשתמש ${user.username}, הקלידו את שם המשתמש בדיוק:`)
    if (typedName !== user.username) return
    setDeletingUserId(user.user_id)
    const result = await deleteAdminUser(session, user.user_id)
    setDeletingUserId('')
    if (result.error) {
      setError(userErrorMessage(result.error))
      return
    }
    if (result.data?.error) {
      const messages = {
        CANNOT_DELETE_SELF_HERE: 'כדי למחוק את החשבון שלך יש להשתמש באפשרות שבפרופיל.',
        PROTECTED_ADMIN: 'לא ניתן למחוק חשבון מנהל מוגן.',
        USER_NOT_FOUND: 'המשתמש לא נמצא או שכבר נמחק.',
      }
      setError(messages[result.data.error] || 'לא ניתן למחוק את המשתמש.')
      return
    }
    await loadDashboard()
    setSuccess('המשתמש נמחק בהצלחה.')
  }

  async function saveUser(event) {
    event.preventDefault()
    setSavingUser(true)
    const result = await updateAdminUser(session, editingUser)
    setSavingUser(false)
    if (result.error) {
      setError(userErrorMessage(result.error))
      return
    }
    if (result.data?.error) {
      const messages = {
        USER_NOT_FOUND: 'המשתמש לא נמצא או שכבר נמחק.',
        INVALID_USERNAME: 'שם המשתמש חייב להכיל בין 2 ל־40 תווים.',
        INVALID_EMAIL: 'יש להזין כתובת אימייל תקינה.',
        INVALID_ROLE: 'יש לבחור תפקיד תקין.',
        WEAK_PASSWORD: 'הסיסמה החדשה חייבת להכיל לפחות 8 תווים.',
        USERNAME_TAKEN: 'שם המשתמש כבר תפוס.',
        EMAIL_TAKEN: 'כתובת האימייל כבר רשומה בחשבון אחר.',
        ACCOUNT_EXISTS: 'שם המשתמש או האימייל כבר קיימים.',
        FAMILY_NOT_FOUND: 'המשפחה שנבחרה אינה קיימת.',
        LAST_FAMILY_MEMBER: 'אי אפשר להוציא את החבר האחרון. יש למחוק את המשפחה במקום.',
        LAST_FAMILY_MANAGER: 'אי אפשר להפוך את מנהל הבית היחיד לקונה. יש למנות קודם מנהל נוסף.',
        PROTECTED_ADMIN_MEMBERSHIP: 'אי אפשר לשנות את המשפחה או התפקיד של מנהל המערכת.',
      }
      setError(messages[result.data.error] || 'לא ניתן לעדכן את המשתמש.')
      return
    }
    const updatedOwnAccount = editingUser.user_id === session.user_id
    setEditingUser(null)
    setSuccess('פרטי המשתמש עודכנו בהצלחה.')
    if (updatedOwnAccount) {
      const refreshedSession = await refreshCurrentSession()
      if (refreshedSession) onSessionChange(refreshedSession)
    }
    await loadDashboard()
  }

  async function removeFamily(family) {
    const typedName = window.prompt(`מחיקת המשפחה תסיר את המלאי, הבקשות וההיסטוריה שלה. המשתמשים עצמם לא יימחקו.\nלהמשך, הקלידו בדיוק: ${family.family_name}`)
    if (typedName !== family.family_name) return
    setDeletingFamilyId(family.family_id)
    const result = await deleteAdminFamily(session, family.family_id)
    setDeletingFamilyId('')
    if (result.error) {
      setError(userErrorMessage(result.error))
      return
    }
    if (result.data?.error) {
      const messages = {
        FAMILY_NOT_FOUND: 'המשפחה לא נמצאה או שכבר נמחקה.',
        PROTECTED_ADMIN_FAMILY: 'אי אפשר למחוק את המשפחה של מנהל המערכת.',
      }
      setError(messages[result.data.error] || 'לא ניתן למחוק את המשפחה.')
      return
    }
    if (familyId === family.family_id) setFamilyId('')
    if (userFamilyId === family.family_id) setUserFamilyId('')
    setSuccess('המשפחה והמידע השייך לה נמחקו. המשתמשים נשארו ללא שיוך.')
    await loadDashboard()
  }

  return (
    <section className="space-y-4">
      <TopNotice notice={error ? { tone: 'error', text: error } : success ? { tone: 'success', text: success } : null} onDismiss={() => { setError(''); setSuccess('') }} />

      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-indigo-950 to-cyan-950 p-5 text-white shadow-xl">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">Admin</p>
        <h2 className="mt-1 text-3xl font-black">מרכז הניהול</h2>
        <p className="mt-2 text-sm text-slate-300">תמונה חיה של המשפחות, המשתמשים והפעילות באתר.</p>
        <div className="mt-4 flex items-center gap-2 text-xs font-bold text-emerald-300">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" />
          מתעדכן בשקט כל 15 שניות
        </div>
      </div>

      {loading ? <AdminLoading /> : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="משפחות" value={summary.families} tone="cyan" />
            <MetricCard label="משתמשים" value={summary.users} tone="rose" />
            <MetricCard label="בקשות פתוחות" value={summary.pending_requests} tone="amber" />
            <MetricCard label="פעילים ב־24 שעות" value={summary.active_users_24h} tone="emerald" />
          </div>

          {session.is_system_admin ? (
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 shadow-sm dark:border-indigo-500/30 dark:bg-indigo-500/10">
              <h3 className="font-black text-indigo-950 dark:text-indigo-100">תצוגת אתר מלאה</h3>
              <p className="mt-1 text-xs text-indigo-700 dark:text-indigo-200">בחרו משפחה כדי לפתוח את כל עמודי האתר כמנהל מערכת.</p>
              <div className="mt-3 flex gap-2">
                <select className="h-11 min-w-0 flex-1 rounded-xl border border-indigo-200 bg-white px-3 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" disabled={switchingFamily} onChange={(event) => setViewFamilyId(event.target.value)} value={viewFamilyId}>
                  <option value="">{session.home_family_id ? 'המשפחה שלי' : 'תצוגה כללית'}</option>
                  {families.map((family) => <option key={family.family_id} value={family.family_id}>{family.family_name}</option>)}
                </select>
                <button className="h-11 shrink-0 rounded-xl bg-indigo-950 px-4 text-sm font-black text-white disabled:opacity-50 dark:bg-cyan-400 dark:text-slate-950" disabled={switchingFamily || viewFamilyId === (session.admin_family_id || '')} onClick={() => changeFamilyView(viewFamilyId)} type="button">{switchingFamily ? 'עובר...' : viewFamilyId ? 'פתיחה' : 'חזרה'}</button>
              </div>
              {session.family_id ? <p className="mt-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">מציג כעת: {session.family_name}. עמודי האתר המלאים זמינים בתפריט התחתון.</p> : null}
            </div>
          ) : null}

          <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-black">מצב המשפחות</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">{summary.products || 0} מוצרים במאגר · {summary.purchases_7d || 0} קניות השבוע</p>
              </div>
              <span className="rounded-xl bg-cyan-100 px-3 py-2 text-xs font-black text-cyan-950 dark:bg-cyan-400 dark:text-slate-950">{families.length}</span>
            </div>
            <div className="mt-3 flex snap-x gap-3 overflow-x-auto pb-1">
              {families.map((family) => (
                <article
                  className={`min-w-[13rem] snap-start rounded-2xl border p-3 text-right transition ${familyId === family.family_id ? 'border-rose-500 bg-rose-50 dark:border-cyan-400 dark:bg-cyan-400/10' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800'}`}
                  key={family.family_id}
                >
                  <button className="w-full text-right" onClick={() => setFamilyId((current) => current === family.family_id ? '' : family.family_id)} type="button">
                    <p className="truncate font-black">{family.family_name}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{family.member_count} משתמשים · {family.inventory_products} במלאי</p>
                    <div className="mt-3 flex items-center justify-between text-xs font-bold">
                      <span className="text-amber-700 dark:text-amber-300">{family.pending_requests} בקשות</span>
                      <span className="text-emerald-700 dark:text-emerald-300">{family.purchases_7d} נקנו השבוע</span>
                    </div>
                  </button>
                  <button className="mt-3 w-full rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-700 disabled:opacity-50 dark:bg-red-500/10 dark:text-red-200" disabled={deletingFamilyId === family.family_id || family.family_id === session.home_family_id} onClick={() => removeFamily(family)} type="button">
                    {family.family_id === session.home_family_id ? 'המשפחה שלך מוגנת' : deletingFamilyId === family.family_id ? 'מוחק...' : 'מחיקת משפחה'}
                  </button>
                </article>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
            <div>
              <h3 className="text-lg font-black">משתמשים</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">כל המשתמשים הפעילים באתר. חשבונות מנהל מוגנים ממחיקה.</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <input className="h-11 min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none dark:border-slate-700 dark:bg-slate-800" onChange={(event) => setUserSearch(event.target.value)} placeholder="חיפוש משתמש" value={userSearch} />
              <select className="h-11 min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-800" onChange={(event) => setUserFamilyId(event.target.value)} value={userFamilyId}>
                <option value="">כל המשפחות</option>
                <option value="__none">ללא משפחה</option>
                {families.map((family) => <option key={family.family_id} value={family.family_id}>{family.family_name}</option>)}
              </select>
            </div>
            <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full min-w-[48rem] border-collapse text-right text-sm">
                <thead className="bg-slate-100 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <tr><th className="p-3">משתמש</th><th className="p-3">אימייל</th><th className="p-3">משפחה</th><th className="p-3">תפקיד</th><th className="p-3">כניסה אחרונה</th><th className="p-3">חיבורים</th><th className="p-3">פעולות</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visibleUsers.map((user) => (
                    <tr key={user.user_id}>
                      <td className="p-3 font-black">{user.username}{user.is_admin ? <span className="me-2 rounded bg-violet-100 px-2 py-1 text-[0.65rem] text-violet-800 dark:bg-violet-400/20 dark:text-violet-200">מנהל</span> : null}</td>
                      <td className="p-3" dir="ltr">{user.email || '—'}</td>
                      <td className="p-3">{user.family_name || 'ללא משפחה'}</td>
                      <td className="p-3">{user.member_role === 'manager' ? 'ניהול הבית' : user.app_role === 'shopper' ? 'קונה' : 'ללא שיוך'}</td>
                      <td className="p-3">{user.last_login_at ? relativeTime(user.last_login_at) : 'לא ידוע'}</td>
                      <td className="p-3">{user.active_sessions}</td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          <button className="rounded-lg bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-800 dark:bg-cyan-400/10 dark:text-cyan-200" onClick={() => setEditingUser({ ...user, family_id: user.family_id || '', new_password: '' })} type="button">עריכה ושיוך</button>
                          {user.is_admin ? <span className="self-center text-xs font-bold text-slate-400">מוגן</span> : <button className="rounded-lg bg-red-50 px-3 py-2 text-xs font-black text-red-700 disabled:opacity-50 dark:bg-red-500/10 dark:text-red-200" disabled={deletingUserId === user.user_id} onClick={() => deleteUser(user)} type="button">{deletingUserId === user.user_id ? 'מוחק...' : 'מחיקה'}</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3 className="text-lg font-black">פעילות אחרונה</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">{familyId ? families.find((family) => family.family_id === familyId)?.family_name : 'כל המשפחות'}</p>
              </div>
              <select className="h-10 max-w-[10rem] rounded-xl border border-slate-200 bg-slate-50 px-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-800" onChange={(event) => setFamilyId(event.target.value)} value={familyId}>
                <option value="">כל המשפחות</option>
                {families.map((family) => <option key={family.family_id} value={family.family_id}>{family.family_name}</option>)}
              </select>
            </div>

            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {activityTypes.map((type) => (
                <button className={`shrink-0 rounded-xl px-3 py-2 text-xs font-black ${activityType === type.key ? 'bg-slate-950 text-white dark:bg-cyan-400 dark:text-slate-950' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`} key={type.key} onClick={() => setActivityType(type.key)} type="button">{type.label}</button>
              ))}
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              {activityPeriods.map((period) => (
                <button className={`rounded-lg px-2 py-2 text-xs font-black transition ${activityPeriod === period.key ? 'bg-white text-slate-950 shadow-sm dark:bg-cyan-400 dark:text-slate-950' : 'text-slate-500 dark:text-slate-300'}`} key={period.key} onClick={() => setActivityPeriod(period.key)} type="button">{period.label}</button>
              ))}
            </div>

            <div className="mt-3 space-y-2">
              {visibleActivity.length === 0 ? <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500 dark:bg-slate-800">אין פעילות להצגה.</p> : visibleActivity.map((item) => <ActivityRow item={item} key={item.activity_id} />)}
            </div>
          </div>
        </>
      )}
      {editingUser ? <UserEditor families={families} onCancel={() => setEditingUser(null)} onChange={setEditingUser} onSubmit={saveUser} saving={savingUser} user={editingUser} /> : null}
    </section>
  )
}

function UserEditor({ families, onCancel, onChange, onSubmit, saving, user }) {
  const protectedMembership = user.is_system_admin
  const update = (field, value) => onChange((current) => ({ ...current, [field]: value }))
  return (
    <div className="app-modal-overlay bg-slate-950/60" dir="rtl">
      <form className="app-modal-panel rounded-3xl bg-white p-5 shadow-2xl dark:bg-slate-900" onSubmit={onSubmit}>
        <div className="flex items-start justify-between gap-3">
          <div><h3 className="text-xl font-black">עריכת משתמש</h3><p className="text-xs text-slate-500 dark:text-slate-400">אפשר לערוך פרטים ולהעביר את המשתמש למשפחה אחרת.</p></div>
          <button className="rounded-full bg-slate-100 px-3 py-2 font-black dark:bg-slate-800" onClick={onCancel} type="button">✕</button>
        </div>
        <div className="mt-5 space-y-4">
          <AdminField label="שם משתמש"><input className="admin-edit-input" maxLength="40" minLength="2" onChange={(event) => update('username', event.target.value)} required value={user.username} /></AdminField>
          <AdminField label="אימייל"><input className="admin-edit-input" dir="ltr" onChange={(event) => update('email', event.target.value)} required type="email" value={user.email || ''} /></AdminField>
          <AdminField label="משפחה">
            <select className="admin-edit-input" disabled={protectedMembership} onChange={(event) => update('family_id', event.target.value)} value={user.family_id || ''}>
              <option value="">ללא משפחה</option>
              {families.map((family) => <option key={family.family_id} value={family.family_id}>{family.family_name}</option>)}
            </select>
          </AdminField>
          <AdminField label="תפקיד">
            <select className="admin-edit-input" disabled={protectedMembership} onChange={(event) => update('app_role', event.target.value)} value={user.app_role}>
              <option value="owner">ניהול הבית</option>
              <option value="shopper">קונה</option>
            </select>
          </AdminField>
          <AdminField label="סיסמה חדשה (לא חובה)"><input autoComplete="new-password" className="admin-edit-input" dir="ltr" minLength="8" onChange={(event) => update('new_password', event.target.value)} placeholder="לפחות 8 תווים" type="password" value={user.new_password} /></AdminField>
          {protectedMembership ? <p className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800 dark:bg-amber-400/10 dark:text-amber-200">המשפחה והתפקיד של מנהל המערכת מוגנים. עדיין אפשר לשנות שם, אימייל וסיסמה.</p> : null}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-2">
          <button className="h-12 rounded-xl bg-slate-100 font-black dark:bg-slate-800" disabled={saving} onClick={onCancel} type="button">ביטול</button>
          <button className="h-12 rounded-xl bg-indigo-950 font-black text-white disabled:opacity-50 dark:bg-cyan-400 dark:text-slate-950" disabled={saving} type="submit">{saving ? 'שומר...' : 'שמירה'}</button>
        </div>
      </form>
    </div>
  )
}

function AdminField({ children, label }) {
  return <label className="block"><span className="mb-1.5 block text-sm font-black">{label}</span>{children}</label>
}

function MetricCard({ label, tone, value = 0 }) {
  const tones = {
    cyan: 'bg-cyan-50 text-cyan-950 dark:bg-cyan-400/10 dark:text-cyan-200',
    rose: 'bg-rose-50 text-rose-950 dark:bg-rose-500/10 dark:text-rose-200',
    amber: 'bg-amber-50 text-amber-950 dark:bg-amber-400/10 dark:text-amber-200',
    emerald: 'bg-emerald-50 text-emerald-950 dark:bg-emerald-400/10 dark:text-emerald-200',
  }
  return <div className={`rounded-2xl p-4 shadow-sm ${tones[tone]}`}><p className="text-3xl font-black">{value}</p><p className="mt-1 text-xs font-bold opacity-75">{label}</p></div>
}

function ActivityRow({ item }) {
  const meta = activityMeta(item)
  return (
    <article className="flex gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ${meta.color}`}>{meta.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="font-black leading-tight">{meta.title}</p>
          <time className="shrink-0 text-[0.7rem] font-bold text-slate-400" dateTime={item.occurred_at}>{relativeTime(item.occurred_at)}</time>
        </div>
        <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{item.actor_name} · {item.family_name}</p>
        {meta.detail ? <p className="mt-1 line-clamp-2 text-xs font-bold text-slate-600 dark:text-slate-300">{meta.detail}</p> : null}
      </div>
    </article>
  )
}

function activityMeta(item) {
  const detail = item.details || {}
  const food = detail.food_name || detail.name || 'מוצר'
  const deleted = item.action === 'delete'
  const updated = item.action === 'update'
  const map = {
    shopping_list: { icon: '📝', title: deleted ? 'הוסרה בקשה' : updated ? 'עודכנה בקשה' : 'נוספה בקשה', detail: `${food}${detail.quantity ? ` · כמות ${detail.quantity}` : ''}`, color: 'bg-amber-100 dark:bg-amber-400/20' },
    inventory_additions: { icon: '📦', title: 'מוצר נוסף למלאי', detail: `${food}${detail.quantity ? ` · כמות ${detail.quantity}` : ''}`, color: 'bg-cyan-100 dark:bg-cyan-400/20' },
    inventory: { icon: '📊', title: deleted ? 'מוצר הוסר מהמלאי' : 'המלאי עודכן', detail: `${food}${detail.quantity ? ` · כמות ${detail.quantity}` : ''}`, color: 'bg-cyan-100 dark:bg-cyan-400/20' },
    purchases: { icon: '🛒', title: 'מוצר נקנה', detail: `${food}${detail.quantity ? ` · כמות ${detail.quantity}` : ''}`, color: 'bg-emerald-100 dark:bg-emerald-400/20' },
    shopping_notes: { icon: '💬', title: deleted ? 'הערה נמחקה' : 'נוספה הערה', detail: detail.body, color: 'bg-indigo-100 dark:bg-indigo-400/20' },
    ratings: { icon: '⭐', title: deleted ? 'דירוג נמחק' : 'מוצר דורג', detail: detail.rating ? `דירוג ${detail.rating}` : food, color: 'bg-yellow-100 dark:bg-yellow-400/20' },
    foods: { icon: '🏷️', title: deleted ? 'מוצר נמחק מהמאגר' : updated ? 'מוצר עודכן' : 'מוצר נוסף למאגר', detail: food, color: 'bg-rose-100 dark:bg-rose-400/20' },
    users: { icon: '👤', title: updated ? 'חשבון עודכן' : 'משתמש חדש נרשם', detail: detail.username, color: 'bg-violet-100 dark:bg-violet-400/20' },
    sessions: { icon: '🔐', title: deleted ? 'משתמש התנתק' : 'משתמש התחבר', detail: '', color: 'bg-slate-200 dark:bg-slate-700' },
    families: { icon: '🏠', title: deleted ? 'משפחה נמחקה' : updated ? 'משפחה עודכנה' : 'משפחה חדשה נוצרה', detail: detail.name, color: 'bg-orange-100 dark:bg-orange-400/20' },
    family_members: { icon: '👥', title: deleted ? 'משתמש עזב משפחה' : 'משתמש הצטרף למשפחה', detail: detail.member_role === 'shopper' ? 'קונה' : 'ניהול הבית', color: 'bg-teal-100 dark:bg-teal-400/20' },
    imported_receipts: { icon: '🧾', title: 'קבלה נסרקה', detail: '', color: 'bg-blue-100 dark:bg-blue-400/20' },
    push_subscriptions: { icon: '🔔', title: deleted ? 'התראות כובו' : 'התראות הופעלו', detail: '', color: 'bg-pink-100 dark:bg-pink-400/20' },
    admin_audit_log: { icon: '🛡️', title: 'פעולת מנהל', detail: detail.action, color: 'bg-red-100 dark:bg-red-400/20' },
  }
  return map[item.entity_type] || { icon: '•', title: 'פעילות באתר', detail: item.entity_type, color: 'bg-slate-100 dark:bg-slate-700' }
}

function activityGroup(entityType) {
  if (['shopping_list', 'shopping_notes', 'purchases', 'imported_receipts'].includes(entityType)) return 'shopping'
  if (['inventory', 'inventory_additions', 'ratings'].includes(entityType)) return 'inventory'
  if (['users', 'sessions', 'families', 'family_members', 'push_subscriptions'].includes(entityType)) return 'accounts'
  if (['foods', 'admin_audit_log'].includes(entityType)) return 'catalog'
  return 'all'
}

function relativeTime(value) {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return ''
  const seconds = Math.round((timestamp - Date.now()) / 1000)
  const formatter = new Intl.RelativeTimeFormat('he', { numeric: 'auto' })
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second')
  const minutes = Math.round(seconds / 60)
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour')
  return formatter.format(Math.round(hours / 24), 'day')
}

function AdminLoading() {
  return <div className="grid grid-cols-2 gap-3">{Array.from({ length: 4 }, (_, index) => <div className="h-24 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" key={index} />)}</div>
}
