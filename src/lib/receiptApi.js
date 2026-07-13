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
  return message || `Request failed with status ${response.status}`
}

function receiptSourceName(item) {
  const source = item.source_payload
  if (source && typeof source === 'object') {
    return String(source.name || source.title || source.productName || source.description || item.name).trim()
  }
  return item.name
}
