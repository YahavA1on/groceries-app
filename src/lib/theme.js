export function getTheme() {
  if (typeof window === 'undefined') return 'dark'
  
  const stored = localStorage.getItem('theme')
  if (stored) return stored
  
  if (window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light'
  }
  return 'dark'
}

export function setTheme(theme) {
  const html = document.documentElement
  html.setAttribute('data-theme', theme)
  localStorage.setItem('theme', theme)
}

export function toggleTheme() {
  const current = getTheme()
  const next = current === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}

export function initTheme() {
  const theme = getTheme()
  setTheme(theme)
}
