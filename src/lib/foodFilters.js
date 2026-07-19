export const ALL_CATEGORIES = 'all'
export const OTHER_CATEGORY = 'אחר'

const categoryDefinitions = [
  {
    value: 'פירות וירקות',
    icon: '🥬',
    keywords: [
      'סלק',
      'סלק אדום',
      'עגבניה',
      'עגבנייה',
      'עגבניות',
      'מלפפון',
      'מלפפונים',
      'בצל',
      'שום',
      'תפוח אדמה',
      'תפוחי אדמה',
      'בננה',
      'מנגו',
      'אגס',
      'ענבים',
      'אבטיח',
      'מלון',
      'אפרסק',
      'נקטרינה',
      'שזיף',
      'קיווי',
      'תות',
      'קלמנטינה',
      'אשכולית',
      'פומלה',
      'אננס',
      'דובדבן',
      'משמש',
      'רימון',
      'חסה',
      'גזר',
      'כרוב',
      'כרובית',
      'ברוקולי',
      'קישוא',
      'חציל',
      'בטטה',
      'צנון',
      'צנונית',
      'סלרי',
      'פטרוזיליה',
      'כוסברה',
      'שמיר',
      'נענע',
      'פלפל אדום',
      'פלפל ירוק',
      'פלפל צהוב',
      'פלפל חריף',
      'אבוקדו',
      'תפוח עץ',
      'לימון',
      'תפוז',
      'בזיליקום',
    ],
    priority: 60,
  },
  {
    value: 'חלב ביצים וסלטים',
    icon: '🥛',
    keywords: [
      'חלב',
      'ביצים',
      'יוגורט',
      'גבינה',
      'גבינות',
      'מוצרלה',
      'שמנת',
      'חמאה',
      'מעדן',
      'קוטג',
      'קוטג׳',
      'לאבנה',
      'לבנה',
      'בולגרית',
      'פטה',
      'צהובה',
      'פרמזן',
      'צפתית',
    ],
    priority: 10,
  },
  {
    value: 'בשר ודגים',
    icon: '🥩',
    keywords: ['בשר', 'עוף', 'חזה עוף', 'הודו', 'דג', 'דגים', 'סלמון', 'טונה', 'נקניק', 'פרגית', 'סטייק', 'אנטריקוט'],
    priority: 20,
  },
  {
    value: 'משקאות',
    icon: '🧃',
    keywords: ['מים', 'קולה', 'מיץ', 'שתיה', 'שתייה', 'יין', 'בירה', 'בירות', 'גולדסטאר', 'משקה', 'סודה', 'תה קר'],
    priority: 30,
  },
  {
    value: 'קפואים',
    icon: '❄️',
    keywords: ['קפוא', 'קפואה', 'קפואים', 'גלידה'],
    priority: 90,
  },
  {
    value: 'שימורים בישול ואפייה',
    icon: '🥫',
    keywords: [
      'שימור',
      'שימורים',
      'קופס',
      'חרדל',
      'טחינה',
      'חומוס',
      'רוטב',
      'רוטב עגבניות',
      'רסק',
      'רכז',
      'רכז עגבניות',
      'עגבניות מרוסקות',
      'עגבניות קצוצות',
      'קטשופ',
      'מיונז',
      'פסטו',
      'קמח',
      'סוכר',
      'שמן',
      'מלח',
      'תבלין',
      'תבלינים',
      'פלפל שחור',
      'פלפל לבן',
      'פלפל גרוס',
      'כמון',
      'אבקת אפייה',
      'אבקת אפיה',
      'תמצית',
      'תמצית וניל',
      'וניל',
      'שמרים',
      'סודה לשתיה',
      'סודה לשתייה',
      'קקאו',
      'פירורי לחם',
    ],
    priority: 5,
  },
  {
    value: 'קטניות ודגנים',
    icon: '🌾',
    keywords: [
      'פסטה',
      'רביולי',
      'אורז',
      'ניוקי',
      'מק אנד צ׳יז',
      'מק אנד ציז',
      'מק אנד צ\'יז',
      'מקרוני',
      'ספגטי',
      'פתיתים',
      'קוסקוס',
      'קינואה',
      'עדשים',
      'שעועית',
      'בורגול',
      'גריסים',
      'חיטה',
      'שיבולת',
      'דגנים',
      'קורנפלקס',
    ],
    priority: 8,
  },
  {
    value: 'חטיפים ומתוקים',
    icon: '🍬',
    keywords: ['חטיף', 'שוקולד', 'עוגיה', 'עוגייה', 'ביסקוויט', 'ממתק', 'ופלים', 'וופל', 'במבה', 'ביסלי', 'צ׳יפס', 'ציפס'],
    priority: 40,
  },
  {
    value: 'לחם ומאפים טריים',
    icon: '🥖',
    keywords: ['לחם', 'לחמניה', 'לחמנייה', 'חלה', 'פיתה', 'טורטיה', 'טורטיות', 'מאפה', 'בגט', 'לחמניות'],
    priority: 25,
  },
]

const explicitCategoryAliases = new Map([
  ['ירקות ופירות', 'פירות וירקות'],
  ['בשר', 'בשר ודגים'],
  ['חלב וביצים', 'חלב ביצים וסלטים'],
  ['לחם ומאפים', 'לחם ומאפים טריים'],
  ['שימורים ורטבים', 'שימורים בישול ואפייה'],
  ['שתייה', 'משקאות'],
  ['אורגני ובריאות', null],
  ['יבשים ומזווה', null],
  ['ניקיון וטואלטיקה', null],
])

const forcedCategoryRules = [
  { category: 'בשר ודגים', keywords: ['סטייק', 'אנטריקוט'] },
  { category: 'קטניות ודגנים', keywords: ['פסטה', 'רביולי', 'אורז', 'ניוקי', 'מק אנד צ׳יז', 'מק אנד ציז', 'מק אנד צ\'יז', 'מקרוני', 'ספגטי'] },
  { category: 'חלב ביצים וסלטים', keywords: ['יוגורט', 'גבינה', 'גבינות', 'מוצרלה', 'פרמזן', 'בולגרית', 'פטה', 'צהובה', 'קוטג', 'קוטג׳'] },
  { category: 'משקאות', keywords: ['גולדסטאר', 'בירה', 'בירות'] },
  {
    category: 'שימורים בישול ואפייה',
    keywords: ['פלפל שחור', 'פלפל לבן', 'פלפל גרוס', 'כמון', 'רכז עגבניות', 'חרדל', 'רוטב עגבניות', 'עגבניות קצוצות', 'עגבניות מרוסקות', 'טחינה', 'חומוס'],
  },
  { category: 'פירות וירקות', keywords: ['בזיליקום', 'סלק אדום', 'סלק'] },
]

const frozenUnlessFreshKeywords = ['גיוזה', 'קציצה', 'קציצות', 'שניצל', 'כיסון', 'כיסונים']
const freshKeywords = ['טרי', 'טריה', 'טרייה', 'טריים', 'טריות']

const CATEGORY_SORT_ORDER = [
  'בשר ודגים',
  'קפואים',
  'חלב ביצים וסלטים',
  'שימורים בישול ואפייה',
  'פירות וירקות',
  'משקאות',
]

const CATEGORY_LABELS = new Map([
  ['בשר ודגים', 'בשר'],
  ['קפואים', 'קפואים'],
  ['חלב ביצים וסלטים', 'חלב'],
  ['שימורים בישול ואפייה', 'שימורים בישול ואפייה'],
  ['פירות וירקות', 'פירות וירקות'],
  ['משקאות', 'משקאות'],
  ['לחם ומאפים טריים', 'לחמים'],
  [OTHER_CATEGORY, OTHER_CATEGORY],
])

const REMOVED_CATEGORIES = new Set([
  'אורגני ובריאות',
  'אחזקת הבית ובע"ח',
  'חד-פעמי ומתכלה',
  'פארם ותינוקות',
])
const activeCategoryDefinitions = categoryDefinitions
  .filter((category) => !REMOVED_CATEGORIES.has(category.value))
  .sort((a, b) => categorySortIndex(a.value) - categorySortIndex(b.value) || a.value.localeCompare(b.value, 'he'))

export const CATEGORY_OPTIONS = [
  { value: ALL_CATEGORIES, label: 'כל הקטגוריות', icon: '☰' },
  ...activeCategoryDefinitions.map((category) => ({
    value: category.value,
    label: categoryDisplayName(category.value),
    icon: category.icon,
  })),
]

const RATING_STYLES = {
  10: {
    tone: 'text-emerald-700 dark:text-emerald-300',
    ring: 'ring-emerald-300 dark:ring-emerald-500/40',
    badge: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100',
    button: 'bg-emerald-600 text-white shadow-sm shadow-emerald-900/20',
    idleButton: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200',
  },
  9: {
    tone: 'text-green-700 dark:text-green-300',
    ring: 'ring-green-300 dark:ring-green-500/40',
    badge: 'bg-green-100 text-green-900 dark:bg-green-500/20 dark:text-green-100',
    button: 'bg-green-600 text-white shadow-sm shadow-green-900/20',
    idleButton: 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-200',
  },
  8: {
    tone: 'text-lime-700 dark:text-lime-300',
    ring: 'ring-lime-300 dark:ring-lime-500/40',
    badge: 'bg-lime-100 text-lime-900 dark:bg-lime-500/20 dark:text-lime-100',
    button: 'bg-lime-600 text-white shadow-sm shadow-lime-900/20',
    idleButton: 'bg-lime-50 text-lime-700 dark:bg-lime-500/15 dark:text-lime-200',
  },
  7: {
    tone: 'text-lime-700 dark:text-lime-300',
    ring: 'ring-lime-300 dark:ring-lime-500/40',
    badge: 'bg-lime-100 text-lime-900 dark:bg-lime-500/20 dark:text-lime-100',
    button: 'bg-lime-600 text-white shadow-sm shadow-lime-900/20',
    idleButton: 'bg-lime-50 text-lime-700 dark:bg-lime-500/15 dark:text-lime-200',
  },
  6: {
    tone: 'text-yellow-700 dark:text-yellow-300',
    ring: 'ring-yellow-300 dark:ring-yellow-500/40',
    badge: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-500/20 dark:text-yellow-100',
    button: 'bg-yellow-500 text-slate-950 shadow-sm shadow-yellow-900/20',
    idleButton: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-200',
  },
  5: {
    tone: 'text-amber-700 dark:text-amber-300',
    ring: 'ring-amber-300 dark:ring-amber-500/40',
    badge: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100',
    button: 'bg-amber-500 text-slate-950 shadow-sm shadow-amber-900/20',
    idleButton: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200',
  },
  4: {
    tone: 'text-orange-700 dark:text-orange-300',
    ring: 'ring-orange-300 dark:ring-orange-500/40',
    badge: 'bg-orange-100 text-orange-900 dark:bg-orange-500/20 dark:text-orange-100',
    button: 'bg-orange-600 text-white shadow-sm shadow-orange-900/20',
    idleButton: 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-200',
  },
  3: {
    tone: 'text-red-700 dark:text-red-300',
    ring: 'ring-red-300 dark:ring-red-500/40',
    badge: 'bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-100',
    button: 'bg-red-600 text-white shadow-sm shadow-red-900/20',
    idleButton: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200',
  },
  2: {
    tone: 'text-rose-700 dark:text-rose-300',
    ring: 'ring-rose-300 dark:ring-rose-500/40',
    badge: 'bg-rose-100 text-rose-900 dark:bg-rose-500/20 dark:text-rose-100',
    button: 'bg-rose-600 text-white shadow-sm shadow-rose-900/20',
    idleButton: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200',
  },
  1: {
    tone: 'text-red-700 dark:text-red-300',
    ring: 'ring-red-300 dark:ring-red-500/40',
    badge: 'bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-100',
    button: 'bg-red-600 text-white shadow-sm shadow-red-900/20',
    idleButton: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200',
  },
}

const RATING_UNDERLINES = {
  10: 'border-emerald-500',
  9: 'border-green-500',
  8: 'border-lime-500',
  7: 'border-lime-500',
  6: 'border-yellow-500',
  5: 'border-amber-500',
  4: 'border-orange-500',
  3: 'border-red-500',
  2: 'border-rose-500',
  1: 'border-red-600',
}

export const RANKS = [
  ...[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((value) => ({
    key: `rank-${value}`,
    value,
    title: `דירוג ${value}`,
    tone: RATING_STYLES[value].tone,
    ring: RATING_STYLES[value].ring,
    badge: RATING_STYLES[value].badge,
    underline: RATING_UNDERLINES[value],
  })),
  {
    key: 'unrated',
    value: null,
    title: 'לא דורג',
    tone: 'text-slate-500 dark:text-slate-400',
    ring: 'ring-slate-200 dark:ring-slate-700',
    badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    underline: 'border-slate-300 dark:border-slate-700',
  },
]

const SHOPPER_RATING_GROUPS = [
  {
    key: 'loves',
    title: 'אוהב מאוד',
    tone: 'text-emerald-700 dark:text-emerald-300',
    ring: 'ring-emerald-200 dark:ring-emerald-500/30',
    badge: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100',
    underline: 'border-emerald-500',
  },
  {
    key: 'likes',
    title: 'אוהב',
    tone: 'text-lime-700 dark:text-lime-300',
    ring: 'ring-lime-200 dark:ring-lime-500/30',
    badge: 'bg-lime-100 text-lime-900 dark:bg-lime-500/20 dark:text-lime-100',
    underline: 'border-lime-500',
  },
  {
    key: 'likes-less',
    title: 'אוהב פחות',
    tone: 'text-orange-700 dark:text-orange-300',
    ring: 'ring-orange-200 dark:ring-orange-500/30',
    badge: 'bg-orange-100 text-orange-900 dark:bg-orange-500/20 dark:text-orange-100',
    underline: 'border-orange-500',
  },
  {
    key: 'tolerable',
    title: 'סביל',
    tone: 'text-red-700 dark:text-red-300',
    ring: 'ring-red-200 dark:ring-red-500/30',
    badge: 'bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-100',
    underline: 'border-red-500',
  },
  {
    key: 'unrated',
    title: 'לא דורג',
    tone: 'text-slate-400 dark:text-slate-500',
    ring: 'ring-slate-200 dark:ring-slate-800',
    badge: 'bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300',
    underline: 'border-slate-300 dark:border-slate-700',
  },
]

export function buildCategoryOptions(foods) {
  const values = new Set()
  for (const food of foods) {
    if (!isHiddenFood(food)) values.add(getFoodCategory(food))
  }

  const extras = Array.from(values)
    .filter((value) => value && value !== OTHER_CATEGORY && !CATEGORY_OPTIONS.some((option) => option.value === value))
    .sort((a, b) => a.localeCompare(b, 'he'))

  const options = [...CATEGORY_OPTIONS, ...extras.map((value) => ({ value, label: categoryDisplayName(value), icon: '•' }))]
  if (values.has(OTHER_CATEGORY)) options.push({ value: OTHER_CATEGORY, label: categoryDisplayName(OTHER_CATEGORY), icon: '•' })

  return options
}

export function filterFoodRows(rows, { category, getFood = (row) => row.food, search }) {
  return rows.filter((row) => {
    const food = getFood(row)
    if (food) return matchesFoodFilters(food, search, category)
    return (!category || category === ALL_CATEGORIES) && !normalize(search)
  })
}

export function getFoodCategory(food) {
  const haystack = foodSearchText(food)

  const explicit = String(food?.category || '').trim()
  const explicitCategory = resolveExplicitCategory(explicit)
  if (explicitCategory) return explicitCategory

  const forced = getForcedCategory(haystack)
  if (forced) return forced

  const inferred = [...activeCategoryDefinitions]
    .sort((a, b) => a.priority - b.priority)
    .find((category) => category.keywords.some((keyword) => haystack.includes(normalize(keyword))))

  return inferred?.value || OTHER_CATEGORY
}

export function getFoodCategoryLabel(food) {
  return categoryDisplayName(getFoodCategory(food))
}

export function groupFoodsByRank(foods, ratings) {
  return groupItemsByRank(foods, ratings, (food) => food)
}

export function groupFoodsByRatingMood(foods, ratings) {
  return groupItemsByRatingMood(foods, ratings, (food) => food)
}

export function groupRowsByRatingMood(rows, ratings, getFood = (row) => row.food) {
  return groupItemsByRatingMood(rows, ratings, getFood)
}

export function groupRowsByRank(rows, ratings, getFood = (row) => row.food) {
  return groupItemsByRank(rows, ratings, getFood)
}

export function groupItemsByCategory(items, getFood = (item) => item) {
  const groupsByCategory = new Map()

  for (const item of items) {
    const food = getFood(item)
    const category = getFoodCategory(food)
    const group = groupsByCategory.get(category) || {
      key: category,
      title: categoryDisplayName(category),
      items: [],
    }

    group.items.push(item)
    groupsByCategory.set(category, group)
  }

  return Array.from(groupsByCategory.values()).sort((a, b) => categorySortIndex(a.title) - categorySortIndex(b.title) || a.title.localeCompare(b.title, 'he'))
}

export function isHiddenFood(food) {
  const text = foodSearchText(food)
  return text.includes('פיקדון') || text.includes('פקדון')
}

export function matchesFoodFilters(food, search, category) {
  if (!food || isHiddenFood(food)) return false

  const foodCategory = getFoodCategory(food)
  const matchesCategory = !category || category === ALL_CATEGORIES || foodCategory === category
  if (!matchesCategory) return false

  const term = normalize(search)
  if (!term) return true

  return `${foodSearchText(food)} ${normalize(foodCategory)}`.includes(term)
}

export function rankMetaForRating(rating) {
  const value = normalizeRating(rating)
  return RANKS.find((rank) => rank.value === value) || RANKS[RANKS.length - 1]
}

export function ratingColorClass(value, isSelected) {
  const style = RATING_STYLES[value]
  if (!style) return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
  return isSelected ? style.button : style.idleButton
}

export function visibleUniqueFoods(foods) {
  const byKey = new Map()

  foods.forEach((food, index) => {
    if (isHiddenFood(food)) return

    const key = duplicateKey(food)
    const existing = byKey.get(key)
    const candidate = { food, index, score: foodCompletenessScore(food) }
    if (!existing || candidate.score > existing.score) byKey.set(key, { ...candidate, index: existing?.index ?? index })
  })

  return Array.from(byKey.values())
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.food)
}

function duplicateKey(food) {
  return [
    food?.name,
    food?.manufacturer,
    food?.unit_qty,
  ]
    .map((value) => normalize(value).replace(/\s+/g, ' '))
    .join('|')
}

function categorySortIndex(category) {
  if (category === OTHER_CATEGORY) return Number.MAX_SAFE_INTEGER

  const requestedIndex = CATEGORY_SORT_ORDER.indexOf(category)
  if (requestedIndex !== -1) return requestedIndex

  const definitionIndex = categoryDefinitions.findIndex((entry) => entry.value === category)
  return definitionIndex === -1 ? Number.MAX_SAFE_INTEGER - 1 : CATEGORY_SORT_ORDER.length + definitionIndex
}

function categoryDisplayName(category) {
  return CATEGORY_LABELS.get(category) || category
}

function foodCompletenessScore(food) {
  return Number(Boolean(resolveExplicitCategory(food?.category))) * 8 + Number(Boolean(food?.picture_url)) * 4 + Number(Boolean(food?.manufacturer)) * 2 + Number(Boolean(food?.unit_qty))
}

function foodSearchText(food) {
  return normalize([food?.name, food?.manufacturer, food?.unit_qty, food?.category].filter(Boolean).join(' '))
}

function getForcedCategory(haystack) {
  const isFresh = freshKeywords.some((keyword) => haystack.includes(normalize(keyword)))
  const isUsuallyFrozen = frozenUnlessFreshKeywords.some((keyword) => haystack.includes(normalize(keyword)))
  if (isUsuallyFrozen) return isFresh ? 'בשר ודגים' : 'קפואים'

  const rule = forcedCategoryRules.find((entry) => entry.keywords.some((keyword) => haystack.includes(normalize(keyword))))
  return rule?.category || null
}

function groupItemsByRank(items, ratings, getFood) {
  const groups = RANKS.map((rank) => ({ ...rank, items: [], foods: [] }))

  for (const item of items) {
    const food = getFood(item)
    const rating = normalizeRating(ratings?.[food?.id])
    const group = groups.find((entry) => entry.value === rating) || groups[groups.length - 1]
    group.items.push(item)
    group.foods.push(item)
  }

  return groups.filter((group) => group.items.length > 0)
}

function groupItemsByRatingMood(items, ratings, getFood) {
  const groups = SHOPPER_RATING_GROUPS.map((group) => ({ ...group, items: [], foods: [] }))

  for (const item of items) {
    const food = getFood(item)
    const group = groups.find((entry) => entry.key === shopperMoodKey(ratings?.[food?.id]))
    group.items.push(item)
    group.foods.push(item)
  }

  return groups.filter((group) => group.items.length > 0)
}

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function normalizeRating(value) {
  const rating = Number(value)
  return Number.isInteger(rating) && rating >= 1 && rating <= 10 ? rating : null
}

function shopperMoodKey(value) {
  const rating = normalizeRating(value)
  if (rating === null) return 'unrated'
  if (rating >= 8) return 'loves'
  if (rating >= 6) return 'likes'
  if (rating >= 4) return 'likes-less'
  return 'tolerable'
}

function resolveExplicitCategory(value) {
  if (!value) return null
  const normalized = normalize(value)
  if (Array.from(REMOVED_CATEGORIES).some((category) => normalize(category) === normalized)) return null

  const exact = activeCategoryDefinitions.find((category) => normalize(category.value) === normalized)
  if (exact) return exact.value

  for (const [alias, category] of explicitCategoryAliases) {
    if (normalize(alias) === normalized) return category
  }

  return value
}
