const knownMessages = [
  [/invalid or expired session|session expired|jwt expired/i, 'החיבור פג. יש להתחבר מחדש.'],
  [/administrator access required|only household managers|permission denied|row-level security/i, 'אין לחשבון הזה הרשאה לבצע את הפעולה.'],
  [/user is not assigned to a family/i, 'המשתמש אינו משויך למשפחה.'],
  [/product already exists|duplicate key.*product|duplicate key.*food/i, 'המוצר כבר קיים במאגר.'],
  [/invalid product weight/i, 'יש להזין משקל או כמות תקינים למוצר.'],
  [/note must contain/i, 'ההערה חייבת להכיל בין 1 ל־300 תווים.'],
  [/invalid push endpoint|invalid push keys/i, 'לא ניתן להפעיל התראות במכשיר הזה.'],
  [/failed to fetch|networkerror|network request failed/i, 'אין כרגע חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.'],
]

const knownCodes = {
  23503: 'אי אפשר לבצע את הפעולה כי הפריט נמצא בשימוש.',
  23505: 'הפריט כבר קיים.',
  42501: 'אין לחשבון הזה הרשאה לבצע את הפעולה.',
}

export function userErrorMessage(error, fallback = 'לא ניתן להשלים את הפעולה.') {
  if (!error) return fallback
  const message = String(error.message || error)
  for (const [pattern, translated] of knownMessages) {
    if (pattern.test(message)) return translated
  }
  if (knownCodes[error.code]) return knownCodes[error.code]
  return message || fallback
}
