const NON_FOOD_PATTERN = /פדים|מסיר\s*איפור|איפור|שמפו|מרכך\s*(?:כביסה|שיער|לחות)|סבון|חיתולים|מגבונים|שקיות|נייר\s*(?:טואלט|אפייה)|בלונים?|אקונומיקה|כביסה|דאודורנט|משחת\s*שיניים|כלים\s*חד|פיקדון|פקדון|(?:^|\s)מים(?:\s|$)|shampoo|soap|cleaner|detergent|cosmetic|balloons?/i
const NON_RATEABLE_PATTERN = /אבקת\s*(?:אפייה|סוכר)|בזיליקום|בצל|שום|חרדל|טחינה\s*גולמית|כמון|סוכר\s*וניל|פלפל\s*(?:שחור|לבן|גרוס)|פפריקה|צ'ילי\s*גרוס|תבלין|תמצית\s*וניל|קמח|שמנת|רסק\s*עגבניות|רכז\s*עגבניות|עגבניות\s*(?:מרוסקות|קצוצות)|רוטב\s*(?:עגבניות|צ'ילי|רוזה)/i

export function isNonFoodProduct(food) {
  if (!food) return false
  if (food.is_food === false) return true
  const value = [food.name, food.manufacturer].filter(Boolean).join(' ')
  return NON_FOOD_PATTERN.test(value)
}

export function isRateableFood(food) {
  if (!food || isNonFoodProduct(food)) return false
  const value = [food.name, food.manufacturer].filter(Boolean).join(' ')
  return !NON_RATEABLE_PATTERN.test(value)
}
