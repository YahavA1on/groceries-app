import { supabase } from './supabase'

export async function fetchAdminDashboard(session, familyId = null) {
  const [summaryResult, familiesResult, activityResult, usersResult] = await Promise.all([
    supabase.rpc('admin_dashboard_summary', { p_session_token: session.token }),
    supabase.rpc('admin_list_families', { p_session_token: session.token }),
    supabase.rpc('admin_list_activity', {
      p_session_token: session.token,
      p_family_id: familyId || null,
      p_limit: 120,
      p_before_id: null,
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

export async function deleteAdminUser(session, userId) {
  const { data, error } = await supabase.rpc('admin_delete_app_user', {
    p_session_token: session.token,
    p_user_id: userId,
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
