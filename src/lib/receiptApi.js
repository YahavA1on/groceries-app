import { supabaseKey, supabaseUrl } from './supabase'

const functionUrl = `${supabaseUrl}/functions/v1/receipt-proxy`

export async function fetchReceiptFromServer(receiptUrl) {
  if (import.meta.env.DEV) {
    return fetchText(`/api/receipt-text?url=${encodeURIComponent(receiptUrl)}`)
  }

  return fetchText(functionUrl, {
    method: 'POST',
    headers: functionHeaders(),
    body: JSON.stringify({ action: 'receipt', url: receiptUrl }),
  })
}

export async function fetchCatalogFromServer(query, store = '331') {
  if (import.meta.env.DEV) {
    return fetchJson(`/api/rami-catalog?query=${encodeURIComponent(query)}&store=${encodeURIComponent(store)}`)
  }

  return fetchJson(functionUrl, {
    method: 'POST',
    headers: functionHeaders(),
    body: JSON.stringify({ action: 'catalog', query, store }),
  })
}

export async function normalizeReceiptItemsWithAi(items) {
  const compactItems = items.map((item, index) => ({
    index,
    raw_name: receiptSourceName(item),
    current_name: item.name,
    manufacturer: item.manufacturer || '',
    unit_qty: item.unit_qty || '',
    candidates: (item.match_candidates || []).map((food) => ({
      id: String(food.id),
      name: food.name || '',
      manufacturer: food.manufacturer || '',
      unit_qty: food.unit_qty || '',
    })),
  }))

  const payload = await fetchJson(functionUrl, {
    method: 'POST',
    headers: functionHeaders(),
    body: JSON.stringify({ action: 'normalize', items: compactItems }),
  })

  return Array.isArray(payload?.items) ? payload.items : []
}

export async function findEquivalentCatalogFood(product, foods, excludeFoodId = null) {
  const manufacturerKey = normalizeIdentityText(product.manufacturer)
  const unitKey = normalizeIdentityUnit(product.unit_qty)
  const candidates = (foods || []).filter((food) => (
    food.id !== excludeFoodId
    && normalizeIdentityText(food.manufacturer) === manufacturerKey
    && normalizeIdentityUnit(food.unit_qty) === unitKey
  ))
  if (candidates.length === 0) return null

  const nameKey = normalizeIdentityText(product.name)
  const exactMatch = candidates.find((food) => normalizeIdentityText(food.name) === nameKey)
  if (exactMatch) return exactMatch

  for (let start = 0; start < candidates.length; start += 50) {
    const batch = candidates.slice(start, start + 50)
    const payload = await fetchJson(functionUrl, {
      method: 'POST',
      headers: functionHeaders(),
      body: JSON.stringify({
        action: 'product-identity',
        product: {
          name: product.name,
          manufacturer: product.manufacturer,
          unit_qty: product.unit_qty,
        },
        candidates: batch.map((food) => ({ id: String(food.id), name: food.name })),
      }),
    })
    const match = batch.find((food) => String(food.id) === String(payload?.matched_food_id))
    if (match) return match
  }
  return null
}

function functionHeaders() {
  return {
    Accept: 'application/json, text/plain, text/html, */*',
    'Content-Type': 'application/json',
    apikey: supabaseKey,
  }
}

async function fetchText(url, options) {
  const response = await fetch(url, options)
  if (!response.ok) throw new Error(await responseError(response))
  return response.text()
}

async function fetchJson(url, options) {
  const response = await fetch(url, options)
  if (!response.ok) throw new Error(await responseError(response))
  return response.json()
}

async function responseError(response) {
  const message = (await response.text()).trim()
  if (response.headers.get('content-type')?.includes('text/html')) {
    return `Upstream service rejected the request (${response.status})`
  }
  return message.slice(0, 500) || `Request failed with status ${response.status}`
}

function receiptSourceName(item) {
  const source = item.source_payload
  if (source && typeof source === 'object') {
    return String(source.name || source.title || source.productName || source.description || item.name).trim()
  }
  return item.name
}

function normalizeIdentityText(value) {
  const finalLetters = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' }
  return String(value || '')
    .trim()
    .toLocaleLowerCase('he')
    .replace(/[ךםןףץ]/g, (letter) => finalLetters[letter])
    .replace(/[^a-z0-9א-ת]+/g, '')
}

function normalizeIdentityUnit(value) {
  const text = String(value || '').trim().toLocaleLowerCase('he').replace(/,/g, '.')
  const numbers = text.match(/\d+(?:\.\d+)?/g) || []
  if (numbers.length !== 1) return normalizeIdentityText(text)
  let amount = Number(numbers[0])
  if (!Number.isFinite(amount)) return normalizeIdentityText(text)

  if (/(ק.?ג|קילו|kg)/i.test(text)) return `${formatIdentityAmount(amount * 1000)}g`
  if (/(גרם|גרמים|גר|gram|grams|(^|[^a-z])g([^a-z]|$))/i.test(text)) return `${formatIdentityAmount(amount)}g`
  if (/(מ.?ל|milliliter|milliliters|ml)/i.test(text)) return `${formatIdentityAmount(amount)}ml`
  if (/(ליטר|ליטרים|liter|liters|litre|litres|(^|[^a-z])l([^a-z]|$))/i.test(text)) return `${formatIdentityAmount(amount * 1000)}ml`
  if (/(יחידה|יחידות|יח|unit|units)/i.test(text)) return `${formatIdentityAmount(amount)}unit`
  return normalizeIdentityText(text)
}

function formatIdentityAmount(value) {
  return String(Number(value.toFixed(3)))
}
