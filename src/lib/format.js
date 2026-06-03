export const requestStatusLabels = {
  pending: 'פתוחה',
  claimed: 'נאספה',
  fulfilled: 'הושלמה',
  cancelled: 'בוטלה',
}

export function formatCurrency(value) {
  if (value == null) return ''
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 2,
  }).format(Number(value))
}

export function formatDate(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('he-IL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function initialsFor(profile) {
  const text = profile?.display_name || profile?.email || '?'
  return text.trim().slice(0, 1).toUpperCase()
}
