import { createClient } from 'npm:@supabase/supabase-js@2.110.7'
import webpush from 'npm:web-push@3.6.7'

const ALLOWED_ORIGINS = new Set([
  'https://yahava1on.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY') || ''
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY') || ''
const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:yahavalon76@gmail.com'

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') || ''
  const corsHeaders = buildCorsHeaders(origin)
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: ALLOWED_ORIGINS.has(origin) ? 204 : 403, headers: corsHeaders })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders)
  if (!ALLOWED_ORIGINS.has(origin)) return json({ error: 'Origin not allowed' }, 403, corsHeaders)
  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
    return json({ error: 'Push service is not configured' }, 503, corsHeaders)
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400, corsHeaders)
  }

  const sessionToken = typeof body.session_token === 'string' ? body.session_token : ''
  const eventType = body.event_type === 'request' || body.event_type === 'purchased' ? body.event_type : ''
  const foodIds = Array.from(new Set(Array.isArray(body.food_ids) ? body.food_ids.filter(isUuid) : [])).slice(0, 50)
  if (!sessionToken || !eventType || foodIds.length === 0) {
    return json({ error: 'Invalid notification event' }, 400, corsHeaders)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: session, error: sessionError } = await admin.rpc('get_app_session', {
    p_session_token: sessionToken,
  })
  if (sessionError || !session || session.error || !session.family_id) {
    return json({ error: 'Invalid session' }, 401, corsHeaders)
  }

  const validFoodIds = await validateEventFoods(admin, eventType, foodIds, session)
  if (validFoodIds.length === 0) return json({ sent: 0 }, 200, corsHeaders)

  const recipientRole = eventType === 'request' ? 'shopper' : 'manager'
  const { data: members, error: membersError } = await admin
    .from('family_members')
    .select('user_id')
    .eq('family_id', session.family_id)
    .eq('member_role', recipientRole)
    .neq('user_id', session.user_id)
  if (membersError) return json({ error: 'Could not load recipients' }, 500, corsHeaders)

  const recipientIds = (members || []).map((member) => member.user_id)
  if (recipientIds.length === 0) return json({ sent: 0 }, 200, corsHeaders)

  const [{ data: subscriptions, error: subscriptionsError }, { data: foods, error: foodsError }] = await Promise.all([
    admin.from('push_subscriptions').select('endpoint,p256dh,auth').eq('family_id', session.family_id).in('user_id', recipientIds),
    admin.from('foods').select('id,name').in('id', validFoodIds),
  ])
  if (subscriptionsError || foodsError) return json({ error: 'Could not prepare notifications' }, 500, corsHeaders)

  const names = (foods || []).map((food) => food.name).filter(Boolean)
  const notification = notificationText(eventType, names)
  const payload = JSON.stringify({
    ...notification,
    tag: `${eventType}-${session.family_id}`,
    url: '/groceries-app/',
  })

  let sent = 0
  for (const subscription of subscriptions || []) {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { auth: subscription.auth, p256dh: subscription.p256dh },
      }, payload, { TTL: 60 * 60 })
      sent += 1
    } catch (error) {
      const statusCode = Number((error as { statusCode?: number }).statusCode || 0)
      if (statusCode === 404 || statusCode === 410) {
        await admin.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
      }
    }
  }

  return json({ sent }, 200, corsHeaders)
})

async function validateEventFoods(admin: ReturnType<typeof createClient>, eventType: string, foodIds: string[], session: Record<string, unknown>) {
  if (eventType === 'request') {
    const { data } = await admin
      .from('shopping_list')
      .select('food_id')
      .eq('family_id', session.family_id)
      .in('food_id', foodIds)
    return Array.from(new Set((data || []).map((row) => row.food_id)))
  }

  const recentCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data } = await admin
    .from('purchases')
    .select('food_id')
    .eq('family_id', session.family_id)
    .eq('shopper_id', session.user_id)
    .gte('purchased_at', recentCutoff)
    .in('food_id', foodIds)
  return Array.from(new Set((data || []).map((row) => row.food_id)))
}

function notificationText(eventType: string, names: string[]) {
  const visibleNames = names.slice(0, 4).join(', ')
  const extra = names.length > 4 ? ` ועוד ${names.length - 4}` : ''
  if (eventType === 'request') {
    return { title: 'בקשה חדשה לקניות', body: `נוספו לרשימה: ${visibleNames}${extra}` }
  }
  return { title: 'המוצרים נקנו', body: `נקנו: ${visibleNames}${extra}` }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function buildCorsHeaders(origin: string): HeadersInit {
  return {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'null',
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
  }
}

function json(value: unknown, status: number, headers: HeadersInit) {
  return new Response(JSON.stringify(value), { status, headers })
}
