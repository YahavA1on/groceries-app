import { supabase } from './supabase'

export const DEFAULT_MANUFACTURER = 'רמי לוי'

const foodSelectWithCategory = 'id, name, manufacturer, unit_qty, picture_url, category, updated_at'
const foodSelect = 'id, name, manufacturer, unit_qty, picture_url, updated_at'
const shoppingListSelectWithCategory =
  'id, owner_id, food_id, quantity, in_cart, added_at, food:foods(id, name, manufacturer, unit_qty, picture_url, category)'
const shoppingListSelect =
  'id, owner_id, food_id, quantity, in_cart, added_at, food:foods(id, name, manufacturer, unit_qty, picture_url)'
const ratingSelects = [
  'food_id, rating, owner_id, updated_at, food:foods(id, name, manufacturer, unit_qty, category)',
  'food_id, rating, owner_id, updated_at, food:foods(id, name, manufacturer, unit_qty)',
  'food_id, rating, owner_id, updated_at',
  'food_id, rating, owner_id',
]

const inventorySelects = [
  'id, owner_id, food_id, quantity, updated_at, created_at, last_purchased_at, purchased_at, purchase_date, food:foods(id, name, manufacturer, unit_qty, picture_url, category)',
  'id, owner_id, food_id, quantity, updated_at, created_at, food:foods(id, name, manufacturer, unit_qty, picture_url, category)',
  'id, owner_id, food_id, quantity, updated_at, created_at, food:foods(id, name, manufacturer, unit_qty, picture_url)',
  'id, owner_id, food_id, quantity, food:foods(id, name, manufacturer, unit_qty, picture_url)',
]

const inventoryDateColumns = ['last_purchased_at', 'purchased_at', 'purchase_date', 'updated_at', null]

export async function addInventoryQuantities(ownerId, itemFoods, purchasedAt = new Date().toISOString()) {
  const foodIds = itemFoods.map(({ food }) => food?.id).filter(Boolean)
  if (!ownerId || foodIds.length === 0) return

  const { data: existingRows, error: existingError } = await supabase
    .from('inventory')
    .select('id, food_id, quantity')
    .eq('owner_id', ownerId)
    .in('food_id', foodIds)

  if (existingError) throw existingError

  const existingByFoodId = new Map((existingRows || []).map((row) => [row.food_id, row]))

  for (const { item, food } of itemFoods) {
    if (!food?.id) continue
    const existing = existingByFoodId.get(food.id)
    if (existing) {
      await updateInventoryRow(existing.id, Number(existing.quantity || 0) + item.quantity, purchasedAt)
    } else {
      await insertInventoryRow(ownerId, food.id, item.quantity, purchasedAt)
    }
  }
}

export async function fetchFoodsWithOptionalCategory() {
  const result = await runFallback([
    () => supabase.from('foods').select(foodSelectWithCategory).order('name', { ascending: true }),
    () => supabase.from('foods').select(foodSelect).order('name', { ascending: true }),
  ])
  return normalizeFoodResult(result)
}

export async function fetchInventoryRows(ownerId) {
  const result = await runFallback(
    inventorySelects.map((select) => () => supabase.from('inventory').select(select).eq('owner_id', ownerId))
  )
  return normalizeNestedFoodResult(result)
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
  const result = await runFallback([
    () => supabase.from('shopping_list').select(shoppingListSelectWithCategory).eq('owner_id', ownerId).order('added_at', { ascending: false }),
    () => supabase.from('shopping_list').select(shoppingListSelect).eq('owner_id', ownerId).order('added_at', { ascending: false }),
  ])
  return normalizeNestedFoodResult(result)
}

async function insertInventoryRow(ownerId, foodId, quantity, purchasedAt) {
  let lastError = null

  for (const dateColumn of inventoryDateColumns) {
    const row = {
      owner_id: ownerId,
      food_id: foodId,
      quantity,
    }
    if (dateColumn) row[dateColumn] = purchasedAt

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

async function updateInventoryRow(rowId, quantity, purchasedAt) {
  let lastError = null

  for (const dateColumn of inventoryDateColumns) {
    const payload = { quantity }
    if (dateColumn) payload[dateColumn] = purchasedAt

    const { error } = await supabase.from('inventory').update(payload).eq('id', rowId)
    if (!error) return
    lastError = error
  }

  throw lastError
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
    data: (result.data || []).map(normalizeFood),
  }
}

function normalizeNestedFoodResult(result) {
  return {
    ...result,
    data: (result.data || []).map((row) => ({
      ...row,
      food: normalizeFood(row.food),
    })),
  }
}
