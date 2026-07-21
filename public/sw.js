self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data?.json() || {}
  } catch {
    payload = { body: event.data?.text() || '' }
  }

  event.waitUntil(self.registration.showNotification(payload.title || 'רשימת קניות', {
    body: payload.body || 'יש עדכון חדש במשפחה.',
    badge: '/groceries-app/rami.jpg',
    data: { url: payload.url || '/groceries-app/' },
    dir: 'rtl',
    icon: '/groceries-app/rami.jpg',
    lang: 'he',
    tag: payload.tag || 'groceries-update',
    renotify: true,
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = new URL(event.notification.data?.url || '/groceries-app/', self.location.origin).href

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existingWindow = windows.find((client) => client.url.startsWith(`${self.location.origin}/groceries-app/`))
    if (existingWindow) {
      await existingWindow.focus()
      existingWindow.navigate(targetUrl)
      return
    }
    await self.clients.openWindow(targetUrl)
  })())
})
