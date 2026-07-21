import { supabase } from './supabase'

export async function fetchAdminDashboard(session, familyId = null) {
  const [summaryResult, familiesResult, activityResult] = await Promise.all([
    supabase.rpc('admin_dashboard_summary', { p_session_token: session.token }),
    supabase.rpc('admin_list_families', { p_session_token: session.token }),
    supabase.rpc('admin_list_activity', {
      p_session_token: session.token,
      p_family_id: familyId || null,
      p_limit: 120,
      p_before_id: null,
    }),
  ])

  const error = summaryResult.error || familiesResult.error || activityResult.error
  return {
    data: error ? null : {
      summary: summaryResult.data || {},
      families: familiesResult.data || [],
      activity: activityResult.data || [],
    },
    error,
  }
}
