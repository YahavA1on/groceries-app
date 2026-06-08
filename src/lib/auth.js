import { supabase } from './supabase'

const STORAGE_KEY = 'groceries_session'

export async function login(username) {
  const cleanUsername = username.trim()
  if (!cleanUsername) return { error: 'הכניסו שם משתמש' }

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, username, role, shops_for_user_id')
    .eq('username', cleanUsername)
    .maybeSingle()

  if (userError) return { error: userError.message }
  if (!user) return { error: 'שם המשתמש לא נמצא' }

  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .insert({ user_id: user.id })
    .select('token, expires_at')
    .single()

  if (sessionError) return { error: sessionError.message }

  const sessionData = {
    token: session.token,
    expires_at: session.expires_at,
    user_id: user.id,
    username: user.username,
    role: user.role,
    shops_for_user_id: user.shops_for_user_id,
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData))
  return { session: sessionData }
}

export async function register(username) {
  const cleanUsername = username.trim()
  if (!cleanUsername) return { error: 'הכניסו שם משתמש' }

  const { data: user, error: userError } = await supabase
    .from('users')
    .insert({ username: cleanUsername, role: 'owner' })
    .select('id, username, role, shops_for_user_id')
    .single()

  if (userError) {
    if (userError.message?.toLowerCase().includes('duplicate')) {
      return { error: 'שם המשתמש כבר קיים' }
    }
    return { error: userError.message }
  }

  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .insert({ user_id: user.id })
    .select('token, expires_at')
    .single()

  if (sessionError) return { error: sessionError.message }

  const sessionData = {
    token: session.token,
    expires_at: session.expires_at,
    user_id: user.id,
    username: user.username,
    role: user.role,
    shops_for_user_id: user.shops_for_user_id,
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData))
  return { session: sessionData }
}

export function getCurrentSession() {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return null

  try {
    const session = JSON.parse(stored)
    if (new Date(session.expires_at) < new Date()) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return session
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export async function logout() {
  const session = getCurrentSession()
  if (session) {
    await supabase.from('sessions').delete().eq('token', session.token)
  }
  localStorage.removeItem(STORAGE_KEY)
}
