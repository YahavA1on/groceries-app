import { supabase } from './supabase'

export async function fetchAdminDashboard(session, familyId = null, activityPeriod = 'week') {
  const [summaryResult, familiesResult, activityResult, usersResult] = await Promise.all([
    supabase.rpc('admin_dashboard_summary', { p_session_token: session.token }),
    supabase.rpc('admin_list_families', { p_session_token: session.token }),
    supabase.rpc('admin_list_activity', {
      p_session_token: session.token,
      p_family_id: familyId || null,
      p_limit: 1000,
      p_before_id: null,
      p_since: activityPeriodStart(activityPeriod),
    }),
    supabase.rpc('admin_list_users', { p_session_token: session.token }),
  ])

  const error = summaryResult.error || familiesResult.error || activityResult.error || usersResult.error
  return {
    data: error ? null : {
      summary: summaryResult.data || {},
      families: familiesResult.data || [],
      activity: activityResult.data || [],
      users: usersResult.data || [],
    },
    error,
  }
}

function activityPeriodStart(period) {
  if (period === 'all') return null
  const days = period === 'month' ? 30 : 7
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

export async function deleteAdminUser(session, userId) {
  const { data, error } = await supabase.rpc('admin_delete_app_user', {
    p_session_token: session.token,
    p_user_id: userId,
  })
  return { data, error }
}

export async function updateAdminUser(session, user) {
  const { data, error } = await supabase.rpc('admin_update_app_user', {
    p_session_token: session.token,
    p_user_id: user.user_id,
    p_username: user.username,
    p_email: user.email,
    p_app_role: user.app_role,
    p_family_id: user.family_id || null,
    p_new_password: user.new_password || null,
  })
  return { data, error }
}

export async function deleteAdminFamily(session, familyId) {
  const { data, error } = await supabase.rpc('admin_delete_family', {
    p_session_token: session.token,
    p_family_id: familyId,
  })
  return { data, error }
}

export async function selectAdminFamily(session, familyId = null) {
  const { data, error } = await supabase.rpc('admin_select_family_context', {
    p_session_token: session.token,
    p_family_id: familyId || null,
  })
  return { data, error }
}
