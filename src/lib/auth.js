import { supabase } from './supabase'
import { userErrorMessage } from './userErrors'

const STORAGE_KEY = 'groceries_session'

const errorMessages = {
  ACCOUNT_EXISTS: 'המשתמש כבר קיים.',
  ACCOUNT_LOCKED: 'החשבון ננעל ל-15 דקות בעקבות ניסיונות כניסה שגויים.',
  CANNOT_DELETE_SELF_HERE: 'כדי למחוק את החשבון שלך יש להשתמש באפשרות שבפרופיל.',
  ADMIN_EMAIL_MISMATCH: 'חשבון המנהל חייב להשתמש באימייל שהוגדר מראש.',
  ALREADY_CONFIGURED: 'החשבון כבר הוגדר. אפשר להתחבר כרגיל.',
  EMAIL_TAKEN: 'האימייל כבר משויך למשתמש אחר.',
  FAMILY_NAME_REQUIRED: 'יש להזין שם למשפחה.',
  INVALID_CREDENTIALS: 'שם המשתמש או הסיסמה שגויים.',
  INVALID_CURRENT_PASSWORD: 'הסיסמה הנוכחית שגויה.',
  INVALID_EMAIL: 'כתובת האימייל אינה תקינה.',
  INVALID_INVITE: 'קוד המשפחה אינו תקין.',
  INVALID_FAMILY_CODE: 'קוד המשפחה חייב להכיל בדיוק 4 אותיות באנגלית או ספרות.',
  INVITE_TAKEN: 'קוד המשפחה כבר בשימוש. בחרו קוד אחר.',
  INVALID_ROLE: 'יש לבחור סוג משתמש.',
  INVALID_FAMILY_SURNAME: 'יש להזין שם משפחה תקין.',
  INVALID_USERNAME: 'שם המשתמש חייב להכיל 2 עד 40 תווים.',
  PROTECTED_ADMIN: 'לא ניתן למחוק חשבון מנהל מוגן.',
  SESSION_EXPIRED: 'החיבור פג. יש להתחבר מחדש.',
  USERNAME_TAKEN: 'שם המשתמש כבר קיים.',
  USER_NOT_FOUND: 'המשתמש לא נמצא או שכבר נמחק.',
  WEAK_PASSWORD: 'הסיסמה חייבת להכיל לפחות 8 תווים.',
}

export async function login(username, password) {
  const { data, error } = await supabase.rpc('login_app_user', {
    p_username: username.trim(),
    p_password: password,
  })
  return handleAuthResult(data, error)
}

export async function register({ email, familyName, inviteCode, password, role, username }) {
  const { data, error } = await supabase.rpc('register_app_user', {
    p_username: username.trim(),
    p_email: email.trim(),
    p_password: password,
    p_role: role,
    p_family_name: role === 'owner' ? `הבית של משפחת ${familyName.trim()}` : null,
    p_invite_code: inviteCode.trim(),
  })
  return handleAuthResult(data, error)
}

export async function updateProfile(session, username, familySurname = null) {
  const { data, error } = await supabase.rpc('update_app_profile', {
    p_session_token: session.token,
    p_username: username.trim(),
    p_family_surname: familySurname === null ? null : familySurname.trim(),
  })
  return handleAuthResult(data, error)
}

export async function changePassword(session, currentPassword, newPassword) {
  const { data, error } = await supabase.rpc('change_app_password', {
    p_session_token: session.token,
    p_current_password: currentPassword,
    p_new_password: newPassword,
  })
  if (error) return { error: userErrorMessage(error) }
  if (!data || data.error) return { error: errorMessages[data?.error] || 'לא ניתן לשנות את הסיסמה.' }
  return { success: true }
}

export async function deleteOwnAccount(session, password) {
  const { data, error } = await supabase.rpc('delete_own_app_account', {
    p_session_token: session.token,
    p_password: password,
  })
  if (error) return { error: userErrorMessage(error) }
  if (!data || data.error) return { error: errorMessages[data?.error] || 'לא ניתן למחוק את החשבון.' }
  localStorage.removeItem(STORAGE_KEY)
  return { success: true, familyTransferredTo: data.family_transferred_to || null }
}

export function saveSession(session) {
  const normalized = normalizeSession(session)
  if (normalized) localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

export async function claimLegacyAccount(session, email, password) {
  const { data, error } = await supabase.rpc('claim_legacy_account', {
    p_session_token: session.token,
    p_email: email.trim(),
    p_password: password,
  })
  return handleAuthResult(data, error)
}

export function getCurrentSession() {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return null

  try {
    const session = normalizeSession(JSON.parse(stored))
    if (!session?.token || new Date(session.expires_at) <= new Date()) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return session
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export async function refreshCurrentSession() {
  const session = getCurrentSession()
  if (!session) return null

  const { data, error } = await supabase.rpc('get_app_session', {
    p_session_token: session.token,
  })
  if (error || !data || data.error) {
    localStorage.removeItem(STORAGE_KEY)
    return null
  }

  const refreshed = normalizeSession(data)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(refreshed))
  return refreshed
}

export async function logout() {
  const session = getCurrentSession()
  if (session) {
    await supabase.rpc('logout_app_user', { p_session_token: session.token })
  }
  localStorage.removeItem(STORAGE_KEY)
}

function handleAuthResult(data, error) {
  if (error) return { error: userErrorMessage(error) }
  if (!data || data.error) return { error: errorMessages[data?.error] || 'לא ניתן להשלים את הפעולה.' }

  const session = saveSession(data)
  return { session }
}

function normalizeSession(session) {
  if (!session) return null
  return {
    ...session,
    is_admin: Boolean(session.is_admin),
    is_system_admin: Boolean(session.is_system_admin),
    shops_for_user_id: session.role === 'shopper' ? session.owner_id : null,
  }
}
