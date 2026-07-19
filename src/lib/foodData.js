import { supabase } from './supabase'
import { isNonFoodProduct } from './productRules'

export const DEFAULT_MANUFACTURER = 'רמי לוי'

const foodSelect = 'id, name, manufacturer, unit_qty, picture_url, updated_at'
const shoppingListSelect =
  'id, owner_id, food_id, quantity, in_cart, added_at, food:foods(id, name, manufacturer, unit_qty, picture_url)'
const ratingSelects = [
  'food_id, rating, owner_id, updated_at, food:foods(id, name, manufacturer, unit_qty)',
  'food_id, rating, owner_id, updated_at',
  'food_id, rating, owner_id',
]

const inventorySelects = [
  'owner_id, food_id, quantity, added_at, created_at, updated_at, last_purchased_at, purchased_at, purchase_date',
  'owner_id, food_id, quantity, updated_at, created_at',
  'owner_id, food_id, quantity',
]

const inventoryInsertDatePayloads = [
  (date) => ({ added_at: date, last_purchased_at: date }),
  (date) => ({ added_at: date }),
  (date) => ({ last_purchased_at: date }),
  (date) => ({ purchased_at: date }),
  (date) => ({ purchase_date: date }),
  (date) => ({ updated_at: date }),
  () => ({}),
]
const inventoryUpdateDatePayloads = [
  (date) => ({ last_purchased_at: date }),
  (date) => ({ purchased_at: date }),
  (date) => ({ purchase_date: date }),
  (date) => ({ updated_at: date }),
  () => ({}),
]

export async function addInventoryQuantities(ownerId, itemFoods, purchasedAt = new Date().toISOString()) {
  const quantityByFoodId = new Map()
  for (const { item, food } of itemFoods) {
    if (!food?.id) continue
    quantityByFoodId.set(food.id, (quantityByFoodId.get(food.id) || 0) + Number(item.quantity || 0))
  }

  const foodIds = Array.from(quantityByFoodId.keys())
  if (!ownerId || foodIds.length === 0) return { newInventoryCount: 0 }

  const { data: existingRows, error: existingError } = await supabase
    .from('inventory')
    .select('food_id, quantity')
    .eq('owner_id', ownerId)
    .in('food_id', foodIds)

  if (existingError) throw existingError

  const existingByFoodId = new Map((existingRows || []).map((row) => [row.food_id, row]))
  const newInventoryCount = foodIds.filter((foodId) => !existingByFoodId.has(foodId)).length
  const expectedQuantities = new Map()

  await Promise.all(Array.from(quantityByFoodId, async ([foodId, addedQuantity]) => {
    const existing = existingByFoodId.get(foodId)
    const nextQuantity = Number(existing?.quantity || 0) + addedQuantity
    expectedQuantities.set(foodId, nextQuantity)

    if (existing) {
      await updateInventoryRow(ownerId, foodId, nextQuantity, purchasedAt)
    } else {
      await insertInventoryRow(ownerId, foodId, addedQuantity, purchasedAt)
    }
  }))

  const savedQuantities = await fetchInventoryQuantities(ownerId, foodIds)
  for (const [foodId, expectedQuantity] of expectedQuantities) {
    if (savedQuantities.get(foodId) !== expectedQuantity) {
      throw new Error('Inventory save did not persist. Check the inventory table policies for this user.')
    }
  }

  return { newInventoryCount }
}

export async function fetchFoodsWithOptionalCategory() {
  const result = await supabase.from('foods').select(foodSelect).order('name', { ascending: true })
  return normalizeFoodResult(result)
}

export async function fetchInventoryRows(ownerId) {
  const result = await runFallback(
    inventorySelects.map((select) => () => supabase.from('inventory').select(select).eq('owner_id', ownerId))
  )
  if (result.error) return normalizeNestedFoodResult(result)

  const rows = result.data || []
  const foodsResult = await fetchFoodsByIds(rows.map((row) => row.food_id))
  const foodsById = new Map((foodsResult.data || []).map((food) => [food.id, food]))

  return normalizeNestedFoodResult({
    ...result,
    data: rows.map((row) => ({
      ...row,
      food: foodsById.get(row.food_id) || null,
    })),
  })
}

export async function fetchInventoryQuantities(ownerId, foodIds) {
  const ids = Array.from(new Set(foodIds.filter(Boolean)))
  if (!ownerId || ids.length === 0) return new Map()

  const { data, error } = await supabase
    .from('inventory')
    .select('food_id, quantity')
    .eq('owner_id', ownerId)
    .in('food_id', ids)

  if (error) throw error

  return new Map((data || []).map((row) => [row.food_id, Number(row.quantity || 0)]))
}

export async function removeInventoryItem(ownerId, foodId) {
  if (!ownerId || !foodId) return

  const { error } = await supabase
    .from('inventory')
    .delete()
    .eq('owner_id', ownerId)
    .eq('food_id', foodId)

  if (error) throw error

  const quantities = await fetchInventoryQuantities(ownerId, [foodId])
  if (quantities.has(foodId)) {
    throw new Error('Inventory item was not removed. Check the inventory table policies for this user.')
  }
}

export async function setInventoryQuantity(ownerId, foodId, quantity) {
  if (!ownerId || !foodId) return

  const nextQuantity = Number(quantity || 0)
  if (nextQuantity <= 0) {
    await removeInventoryItem(ownerId, foodId)
    return
  }

  const { error } = await supabase
    .from('inventory')
    .update({ quantity: nextQuantity })
    .eq('owner_id', ownerId)
    .eq('food_id', foodId)

  if (error) throw error

  await verifyInventoryQuantity(ownerId, foodId, nextQuantity)
}

export async function fetchRatingsByOwner(ownerId) {
  if (!ownerId) return { data: {}, error: null }

  const result = await runFallback(
    ratingSelects.map((select) => () => supabase.from('ratings').select(select).eq('owner_id', ownerId))
  )
  if (result.error) return { data: {}, error: result.error, rows: [] }

  const rows = (result.data || []).map((row) => ({ ...row, food: normalizeFood(row.food) }))
  const ratings = {}
  for (const row of rows) ratings[row.food_id] = row.rating
  return { data: ratings, error: null, rows }
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

export async function fetchShoppingListItems(ownerId) {
  const result = await supabase.from('shopping_list').select(shoppingListSelect).eq('owner_id', ownerId).order('added_at', { ascending: false })
  return normalizeNestedFoodResult(result)
}

async function fetchFoodsByIds(foodIds) {
  const ids = Array.from(new Set(foodIds.filter(Boolean)))
  if (ids.length === 0) return { data: [], error: null }

  const result = await supabase.from('foods').select(foodSelect).in('id', ids)

  return normalizeFoodResult(result)
}

async function insertInventoryRow(ownerId, foodId, quantity, purchasedAt) {
  let lastError = null

  for (const buildDatePayload of inventoryInsertDatePayloads) {
    const row = {
      owner_id: ownerId,
      food_id: foodId,
      quantity,
      ...buildDatePayload(purchasedAt),
    }

    const { error } = await supabase.from('inventory').insert(row)
    if (!error) return
    lastError = error
  }

  throw lastError
}

async function runFallback(builders) {
  let lastError = null

  for (const buildQuery of builders) {
    const result = await buildQuery()
    if (!result.error) return result
    lastError = result.error
  }

  return { data: [], error: lastError }
}

async function updateInventoryRow(ownerId, foodId, quantity, purchasedAt) {
  let lastError = null

  for (const buildDatePayload of inventoryUpdateDatePayloads) {
    const payload = { quantity, ...buildDatePayload(purchasedAt) }

    const { error } = await supabase.from('inventory').update(payload).eq('owner_id', ownerId).eq('food_id', foodId)
    if (!error) return
    lastError = error
  }

  throw lastError
}

async function verifyInventoryQuantity(ownerId, foodId, expectedQuantity) {
  const quantities = await fetchInventoryQuantities(ownerId, [foodId])
  const savedQuantity = quantities.get(foodId)

  if (savedQuantity !== expectedQuantity) {
    throw new Error('Inventory save did not persist. Check the inventory table policies for this user.')
  }
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
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function normalizeFood(food) {
  if (!food) return food
  return {
    ...food,
    manufacturer: food.manufacturer || DEFAULT_MANUFACTURER,
  }
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
      .map((row) => ({
        ...row,
        food: normalizeFood(row.food),
      }))
      .filter((row) => !isNonFoodProduct(row.food)),
  }
}
