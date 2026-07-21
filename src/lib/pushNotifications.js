import { supabase } from './supabase'

const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY || 'BIpYf36aR894qxsWFQwvkLE1hPPPrCKVGnmVRRTlzj0VyZqqxMt6cMoB6-uL9LTYoPO5SKZ7n1VzyY7blsO9qHQ'
const promptStoragePrefix = 'groceries_push_prompt_'

export function pushCapability() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { supported: false, reason: 'הדפדפן הזה אינו תומך בהתראות Push.' }
  }
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
  if (isIos && !isStandalone) {
    return { supported: false, reason: 'ב-iPhone יש להוסיף את האתר למסך הבית, לפתוח אותו משם ואז להפעיל התראות.' }
  }
  if (!vapidPublicKey) return { supported: false, reason: 'מפתח ההתראות הציבורי עדיין לא הוגדר.' }
  return { supported: true, reason: '' }
}

export async function getPushSubscription() {
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

export async function enablePushNotifications(session) {
  const capability = pushCapability()
  if (!capability.supported) throw new Error(capability.reason)

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('לא ניתן אישור לשליחת התראות.')

  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    })
  }

  const json = subscription.toJSON()
  const { error } = await supabase.rpc('save_push_subscription', {
    p_session_token: session.token,
    p_endpoint: subscription.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
    p_user_agent: navigator.userAgent,
  })
  if (error) {
    await subscription.unsubscribe()
    throw error
  }
  rememberPushPromptChoice(session, 'enabled')
  return subscription
}

export async function disablePushNotifications(session) {
  const subscription = await getPushSubscription()
  if (!subscription) {
    rememberPushPromptChoice(session, 'disabled')
    return
  }

  const { error } = await supabase.rpc('delete_push_subscription', {
    p_session_token: session.token,
    p_endpoint: subscription.endpoint,
  })
  if (error) throw error
  await subscription.unsubscribe()
  rememberPushPromptChoice(session, 'disabled')
}

export function hasAnsweredPushPrompt(session) {
  if (!session?.user_id) return true
  try {
    return Boolean(localStorage.getItem(`${promptStoragePrefix}${session.user_id}`))
  } catch {
    return false
  }
}

export function rememberPushPromptChoice(session, choice) {
  if (!session?.user_id) return
  try {
    localStorage.setItem(`${promptStoragePrefix}${session.user_id}`, choice)
  } catch {
    // The browser may block storage in private mode; notifications can still work.
  }
  window.dispatchEvent(new CustomEvent('groceries:push-choice', { detail: { choice } }))
}

export async function sendPushEvent(session, eventType, foodIds) {
  const ids = Array.from(new Set((foodIds || []).filter(Boolean)))
  if (!session?.token || ids.length === 0) return
  const { error } = await supabase.functions.invoke('send-push', {
    body: {
      event_type: eventType,
      food_ids: ids,
      session_token: session.token,
    },
  })
  if (error) throw error
}

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)))
}
