import { supabase } from './supabase'
import { isNonFoodProduct } from './productRules'

export const DEFAULT_MANUFACTURER = 'רמי לוי'

const foodSelect = 'id, source, external_id, name, manufacturer, unit_qty, picture_url, category, created_by, updated_at'

export async function addInventoryQuantities(session, itemFoods) {
  const quantityByFoodId = new Map()
  for (const { item, food } of itemFoods) {
    if (!food?.id) continue
    quantityByFoodId.set(food.id, (quantityByFoodId.get(food.id) || 0) + Number(item.quantity || 0))
  }

  const foodIds = Array.from(quantityByFoodId.keys())
  if (!session?.token || foodIds.length === 0) return { newInventoryCount: 0 }

  const inventoryBefore = await fetchInventoryQuantities(session, foodIds)
  const { error } = await supabase.rpc('add_family_inventory_items', {
    p_session_token: session.token,
    p_items: Array.from(quantityByFoodId, ([food_id, quantity]) => ({ food_id, quantity })),
  })
  if (error) throw error

  return {
    newInventoryCount: foodIds.filter((foodId) => !inventoryBefore.has(foodId)).length,
  }
}

export async function fetchFoodsWithOptionalCategory() {
  const result = await supabase.from('foods').select(foodSelect).order('name', { ascending: true })
  return normalizeFoodResult(result)
}

export async function fetchInventoryRows(session) {
  const result = await supabase.rpc('list_family_inventory', {
    p_session_token: session?.token,
  })
  if (result.error) return normalizeNestedFoodResult(result)

  const rows = result.data || []
  const [foodsResult, additionsResult] = await Promise.all([
    fetchFoodsByIds(rows.map((row) => row.food_id)),
    supabase.rpc('list_family_inventory_additions', { p_session_token: session?.token }),
  ])
  if (additionsResult.error) return { ...result, error: additionsResult.error, data: [] }
  const foodsById = new Map((foodsResult.data || []).map((food) => [food.id, food]))
  const additionsByFoodId = new Map()
  for (const addition of additionsResult.data || []) {
    const additions = additionsByFoodId.get(addition.food_id) || []
    additions.push({ ...addition, quantity: Number(addition.quantity || 0) })
    additionsByFoodId.set(addition.food_id, additions)
  }
  return normalizeNestedFoodResult({
    ...result,
    data: rows.map((row) => ({
      ...row,
      additions: additionsByFoodId.get(row.food_id) || [],
      food: foodsById.get(row.food_id) || null,
    })),
  })
}

export async function addReceiptInventoryQuantities(session, itemFoods) {
  const quantityByFoodId = new Map()
  for (const { item, food } of itemFoods) {
    if (!food?.id) continue
    quantityByFoodId.set(food.id, (quantityByFoodId.get(food.id) || 0) + Number(item.quantity || 0))
  }

  const foodIds = Array.from(quantityByFoodId.keys())
  if (!session?.token || foodIds.length === 0) return { newInventoryCount: 0, removedRequestCount: 0 }

  const inventoryBefore = await fetchInventoryQuantities(session, foodIds)
  const { data, error } = await supabase.rpc('add_family_receipt_inventory_items', {
    p_session_token: session.token,
    p_items: Array.from(quantityByFoodId, ([food_id, quantity]) => ({ food_id, quantity })),
  })
  if (error) throw error

  return {
    newInventoryCount: foodIds.filter((foodId) => !inventoryBefore.has(foodId)).length,
    removedRequestCount: Number(data?.removed_request_count || 0),
  }
}

export async function fetchInventoryQuantities(session, foodIds) {
  const ids = Array.from(new Set(foodIds.filter(Boolean)))
  if (!session?.token || ids.length === 0) return new Map()

  const { data, error } = await supabase.rpc('get_family_inventory_quantities', {
    p_session_token: session.token,
    p_food_ids: ids,
  })
  if (error) throw error
  return new Map((data || []).map((row) => [row.food_id, Number(row.quantity || 0)]))
}

export async function removeInventoryItem(session, foodId) {
  return setInventoryQuantity(session, foodId, 0)
}

export async function setInventoryQuantity(session, foodId, quantity) {
  if (!session?.token || !foodId) return
  const { error } = await supabase.rpc('set_family_inventory_quantity', {
    p_session_token: session.token,
    p_food_id: foodId,
    p_quantity: Math.max(0, Number(quantity || 0)),
  })
  if (error) throw error
}

export async function fetchRatingsByOwner(session) {
  if (!session?.token) return { data: {}, error: null, rows: [] }

  const result = await supabase.rpc('list_family_ratings', {
    p_session_token: session.token,
  })
  if (result.error) return { data: {}, error: result.error, rows: [] }

  const rows = result.data || []
  const foodsResult = await fetchFoodsByIds(rows.map((row) => row.food_id))
  const foodsById = new Map((foodsResult.data || []).map((food) => [food.id, food]))
  const normalizedRows = rows.map((row) => ({ ...row, food: foodsById.get(row.food_id) || null }))
  const ratings = {}
  for (const row of normalizedRows) ratings[row.food_id] = row.rating
  return { data: ratings, error: null, rows: normalizedRows }
}

export async function saveFamilyRating(session, foodId, rating) {
  return supabase.rpc('save_family_rating', {
    p_session_token: session.token,
    p_food_id: foodId,
    p_rating: rating,
  })
}

export async function deleteFamilyRating(session, foodId) {
  return supabase.rpc('delete_family_rating', {
    p_session_token: session.token,
    p_food_id: foodId,
  })
}

export async function fetchShoppingListItems(session) {
  const result = await supabase.rpc('list_family_shopping', {
    p_session_token: session?.token,
  })
  if (result.error) return normalizeNestedFoodResult(result)

  const rows = result.data || []
  const foodsResult = await fetchFoodsByIds(rows.map((row) => row.food_id))
  const foodsById = new Map((foodsResult.data || []).map((food) => [food.id, food]))
  return normalizeNestedFoodResult({
    ...result,
    data: rows.map((row) => ({ ...row, food: foodsById.get(row.food_id) || null })),
  })
}

export async function addShoppingListItems(session, items) {
  return supabase.rpc('add_family_shopping_items', {
    p_session_token: session.token,
    p_items: items,
  })
}

export async function setShoppingItemQuantity(session, itemId, quantity) {
  return supabase.rpc('set_family_shopping_quantity', {
    p_session_token: session.token,
    p_item_id: itemId,
    p_quantity: quantity,
  })
}

export async function setShoppingItemCart(session, itemId, inCart) {
  return supabase.rpc('set_family_shopping_cart', {
    p_session_token: session.token,
    p_item_id: itemId,
    p_in_cart: inCart,
  })
}

export async function deleteShoppingItem(session, itemId) {
  return supabase.rpc('delete_family_shopping_item', {
    p_session_token: session.token,
    p_item_id: itemId,
  })
}

export async function finishFamilyShopping(session) {
  return supabase.rpc('finish_family_shopping', {
    p_session_token: session.token,
  })
}

export async function updateFoodUnitQuantity(session, foodId, unitQuantity) {
  return supabase.rpc('set_family_food_unit_qty', {
    p_session_token: session.token,
    p_food_id: foodId,
    p_unit_qty: unitQuantity.trim(),
  })
}

export function applyRelatedRatings(foods, exactRatings, ratingRows = []) {
  const nextRatings = { ...exactRatings }
  const fullKeyRatings = new Map()
  const nameRatings = new Map()

  for (const row of ratingRows) {
    if (!row.food) continue
    collectRating(fullKeyRatings, fullFoodKey(row.food), row)
    collectRating(nameRatings, nameFoodKey(row.food), row)
  }

  for (const food of foods) {
    if (nextRatings[food.id] !== undefined) continue

    const fullMatch = bestRating(fullKeyRatings.get(fullFoodKey(food)))
    if (fullMatch !== null) {
      nextRatings[food.id] = fullMatch
      continue
    }

    const nameMatch = bestRating(nameRatings.get(nameFoodKey(food)), true)
    if (nameMatch !== null) nextRatings[food.id] = nameMatch
  }

  return nextRatings
}

async function fetchFoodsByIds(foodIds) {
  const ids = Array.from(new Set(foodIds.filter(Boolean)))
  if (ids.length === 0) return { data: [], error: null }
  const result = await supabase.from('foods').select(foodSelect).in('id', ids)
  return normalizeFoodResult(result)
}

function bestRating(rows, requireAgreement = false) {
  if (!rows || rows.length === 0) return null
  if (requireAgreement) {
    const values = new Set(rows.map((row) => Number(row.rating)).filter((rating) => Number.isFinite(rating)))
    if (values.size !== 1) return null
  }

  const sorted = [...rows].sort((a, b) => {
    const aTime = new Date(a.updated_at || 0).getTime()
    const bTime = new Date(b.updated_at || 0).getTime()
    return bTime - aTime
  })

  const rating = Number(sorted[0]?.rating)
  return Number.isFinite(rating) ? rating : null
}

function collectRating(map, key, row) {
  if (!key) return
  const rows = map.get(key) || []
  rows.push(row)
  map.set(key, rows)
}

function fullFoodKey(food) {
  return [food?.name, food?.manufacturer, food?.unit_qty].map(normalizeKey).join('|')
}

function nameFoodKey(food) {
  return normalizeKey(food?.name)
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function normalizeFood(food) {
  if (!food) return food
  return { ...food, manufacturer: food.manufacturer || DEFAULT_MANUFACTURER }
}

function normalizeFoodResult(result) {
  return {
    ...result,
    data: (result.data || []).map(normalizeFood).filter((food) => !isNonFoodProduct(food)),
  }
}

function normalizeNestedFoodResult(result) {
  return {
    ...result,
    data: (result.data || [])
      .map((row) => ({ ...row, food: normalizeFood(row.food) }))
      .filter((row) => !isNonFoodProduct(row.food)),
  }
}
