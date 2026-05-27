const CATEGORY_FILTERS = [
  {
    key: 'meat-fish',
    label: 'בשר ודגים',
    matches: ['בשר', 'עוף', 'הודו', 'דג', 'טונה', 'סלמון', 'שניצל', 'נקניק', 'פסטרמה'],
  },
  {
    key: 'drinks',
    label: 'משקאות',
    matches: ['מים', 'מיץ', 'קולה', 'סודה', 'שתיה', 'תה', 'קפה', 'שוקו', 'משקה'],
  },
  {
    key: 'dairy-eggs',
    label: 'חלב וביצים',
    matches: ['חלב', 'ביצים', 'ביצה', 'גבינה', 'יוגורט', 'קוטג', 'שמנת', 'חלמון', 'חלבון'],
  },
  {
    key: 'frozen',
    label: 'קפואים',
    matches: ['קפוא', 'הקפאה', 'פיצה', 'גלידה', 'ירקות קפואים'],
  },
  {
    key: 'canned-cooking',
    label: 'שימורים ובישול ואפייה',
    matches: ['רכז','פפריקה','שימורים', 'בקופסה', 'קופסה', 'שימורי', 'טונה בקופסה', 'עגבניות מרוסקות', 'רסק עגבניות', 'עגבניות בקופסה', 'פסטה', 'אורז', 'קמח', 'סוכר', 'מלח', 'שמן', 'חמאה', 'פירורי לחם', 'טורטיות', 'פתיתים', 'רוטב', 'רוטב עגבניות', 'פסטו', 'שמנת לבישול', 'אבקת חלבון', 'מעדן חלבון'],
  },
  {
    key: 'produce',
    label: 'פירות וירקות',
    matches: ['תפוח', 'בננה', 'תפוז', 'ענב', 'אגס', 'אפרסק', 'תות', 'אבוקדו', 'עגבניה', 'מלפפון', 'בצל', 'שום', 'תפוח אדמה', 'גזר', 'ירק', 'פרי'],
    excludes: ['בטעם','רוטב', 'רסק', 'מרוסקות', 'שימורים', 'בקופסה'],
  },
]

export const ALL_CATEGORY_KEY = 'all'
export const ALL_CATEGORY_LABEL = 'הכל'

function normalizeText(value) {
  return (value || '').toLowerCase().trim()
}

function matchesCategory(text, category) {
  const hasMatch = category.matches.some((match) => text.includes(normalizeText(match)))
  if (!hasMatch) return false

  const excludes = category.excludes || []
  return !excludes.some((exclude) => text.includes(normalizeText(exclude)))
}

export function getFoodCategory(food) {
  const text = normalizeText(`${food?.name || ''} ${food?.manufacturer || ''}`)
  if (!text) return null

  const found = CATEGORY_FILTERS.find((category) => matchesCategory(text, category))

  return found?.key || null
}

export { CATEGORY_FILTERS }