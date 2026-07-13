const NON_FOOD_PATTERN = /פדים|מסיר\s*איפור|איפור|שמפו|מרכך\s*(?:כביסה|שיער|לחות)|סבון|חיתולים|מגבונים|שקיות|נייר\s*(?:טואלט|אפייה)|בלונים?|אקונומיקה|כביסה|דאודורנט|משחת\s*שיניים|כלים\s*חד|shampoo|soap|cleaner|detergent|cosmetic|balloons?/i

export function isNonFoodProduct(food) {
  if (!food) return false
  if (food.is_food === false) return true
  const value = [food.name, food.manufacturer].filter(Boolean).join(' ')
  return NON_FOOD_PATTERN.test(value)
}
