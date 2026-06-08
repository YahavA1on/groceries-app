const RECEIPT_ITEM_KEYS = [
  'items',
  'products',
  'lines',
  'invoiceItems',
  'receiptItems',
  'saleItems',
  'details',
  'textRows',
]

const NAME_KEYS = ['name', 'title', 'itemName', 'item_name', 'productName', 'product_name', 'description', 'desc']
const MANUFACTURER_KEYS = ['manufacturer', 'brand', 'brandName', 'brand_name', 'supplierName', 'vendor']
const UNIT_KEYS = ['unitQty', 'unit_qty', 'unit', 'size', 'weight', 'measure', 'netContent']
const IMAGE_KEYS = ['image', 'imageUrl', 'image_url', 'picture', 'picture_url', 'pic', 'img']
const BARCODE_KEYS = ['barcode', 'barCode', 'code', 'itemCode', 'item_code', 'sku']
const QUANTITY_KEYS = ['quantity', 'qty', 'amount', 'count', 'units', 'weightQty']

export async function fetchReceiptText(receiptUrl) {
  const directError = await fetchText(receiptUrl).catch((error) => error)
  if (typeof directError === 'string') return directError

  const proxyUrl = `/api/receipt-text?url=${encodeURIComponent(receiptUrl)}`
  const proxyText = await fetchText(proxyUrl).catch((error) => {
    throw new Error(`לא הצלחתי לטעון את הקבלה. ${error.message || directError.message}`)
  })

  return proxyText
}

export function parseReceiptItems(rawText) {
  const text = rawText.trim()
  if (!text) return []

  const payloads = collectPayloads(text)
  const records = []
  const seenRecords = new Set()

  for (const payload of payloads) {
    for (const record of collectItemRecords(payload)) {
      const key = JSON.stringify([firstValue(record, BARCODE_KEYS), firstValue(record, NAME_KEYS)])
      if (!seenRecords.has(key)) {
        seenRecords.add(key)
        records.push(record)
      }
    }
  }

  if (records.length === 0) records.push(...parsePlainTextRows(text))

  const seenItems = new Set()
  return records
    .map(mapReceiptItem)
    .filter(Boolean)
    .filter((item) => !isNonInventoryLine(item.name))
    .filter((item) => {
      const key = `${item.external_id || ''}:${item.name}`
      if (seenItems.has(key)) return false
      seenItems.add(key)
      return true
    })
}

function isNonInventoryLine(name) {
  return /פיקדון|פקדון|זיכוי אריזה|הנחת זיכוי|משלוח|שירות/i.test(name)
}

export function buildFoodInsert(item) {
  return {
    source: 'rami_levy_receipt',
    external_id: item.external_id || stableReceiptId(item.name),
    name: item.name,
    manufacturer: item.manufacturer || null,
    price: null,
    unit_qty: item.unit_qty || null,
    picture_url: item.picture_url || null,
    store_id: item.store_id || null,
    raw: item.source_payload || item,
    updated_at: new Date().toISOString(),
  }
}

function collectPayloads(text) {
  const payloads = []
  const json = parseJson(text)
  if (json) payloads.push(normalizePayload(json))

  if (typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(text, 'text/html')
    const scripts = Array.from(document.querySelectorAll('script'))

    for (const script of scripts) {
      const content = script.textContent?.trim()
      if (!content) continue

      const scriptJson = parseJson(content)
      if (scriptJson) payloads.push(normalizePayload(scriptJson))

      for (const snippet of extractJsonSnippets(content)) {
        const parsed = parseJson(snippet)
        if (parsed) payloads.push(normalizePayload(parsed))
      }
    }

    const rows = Array.from(document.querySelectorAll('tr, li, .item, [data-item]'))
      .map((node) => node.textContent?.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    if (rows.length > 0) payloads.push({ textRows: rows })

    const domItems = extractDomReceiptItems(document)
    if (domItems.length > 0) payloads.unshift({ items: domItems })
  }

  return payloads
}

function extractDomReceiptItems(document) {
  return Array.from(document.querySelectorAll('.product-row-content'))
    .map((row) => {
      const image = row.querySelector('.product-image-wrapper img')
      const name = row.querySelector('.product-info-column')?.textContent?.replace(/\s+/g, ' ').trim()
      const quantityText = row.querySelector('.product-quantity')?.textContent?.replace(/\s+/g, ' ').trim()
      const priceText = row.querySelector('.product-price-wrapper')?.textContent?.replace(/\s+/g, ' ').trim()
      const imageUrl = image?.getAttribute('src') || ''
      const barcode = imageUrl.match(/\/product\/(\d+)\//)?.[1] || null

      if (!name || !quantityText) return null

      return {
        barcode,
        code: barcode,
        name,
        quantity_text: quantityText,
        quantity: quantityFromDom(quantityText),
        unit_qty: unitFromDom(quantityText),
        image_url: normalizeImageUrl(imageUrl),
        price_text: priceText || null,
      }
    })
    .filter(Boolean)
}

function collectItemRecords(payload) {
  const records = []

  function visit(value, key = '', insideItemList = false) {
    if (!value || typeof value !== 'object') return

    if (Array.isArray(value)) {
      if (key === 'textRows') {
        records.push(...value.filter((item) => typeof item === 'string' && looksLikePlainTextProduct(item)))
      } else if (RECEIPT_ITEM_KEYS.includes(key)) {
        for (const item of value) {
          if (looksLikeReceiptItem(item)) records.push(item)
        }
      }
      for (const item of value) visit(item, '', RECEIPT_ITEM_KEYS.includes(key))
      return
    }

    if (insideItemList && looksLikeReceiptItem(value)) records.push(value)

    for (const [nestedKey, nestedValue] of Object.entries(value)) visit(nestedValue, nestedKey)
  }

  visit(payload)
  return records
}

function looksLikeReceiptItem(record) {
  if (typeof record === 'string') return false
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false
  const name = firstValue(record, NAME_KEYS)
  const barcode = firstValue(record, BARCODE_KEYS)
  const quantity = firstValue(record, QUANTITY_KEYS)
  return Boolean(name && (barcode || quantity || firstValue(record, UNIT_KEYS)))
}

function normalizePayload(payload) {
  if (!isEncodedNuxtPayload(payload)) return payload
  return reviveNuxtPayload(payload)
}

function isEncodedNuxtPayload(payload) {
  return (
    Array.isArray(payload) &&
    payload.length > 1 &&
    Array.isArray(payload[0]) &&
    typeof payload[0][0] === 'string' &&
    payload.some((slot) => slot && typeof slot === 'object' && !Array.isArray(slot) && Object.hasOwn(slot, 'items'))
  )
}

function reviveNuxtPayload(table) {
  const cache = new Map()
  const wrappers = new Set(['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef', 'Readonly'])

  function revive(index) {
    if (index === null || index === undefined) return null
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= table.length) return index
    if (cache.has(index)) return cache.get(index)

    const slot = table[index]
    if (Array.isArray(slot) && wrappers.has(slot[0]) && typeof slot[1] === 'number') return revive(slot[1])

    if (Array.isArray(slot)) {
      const array = []
      cache.set(index, array)
      for (const value of slot) array.push(revive(value))
      return array
    }

    if (slot && typeof slot === 'object') {
      const object = {}
      cache.set(index, object)
      for (const [key, value] of Object.entries(slot)) object[key] = revive(value)
      return object
    }

    cache.set(index, slot)
    return slot
  }

  return table.map((_, index) => revive(index))
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { Accept: 'text/html,application/json,text/plain,*/*' },
  })

  if (!response.ok) throw new Error(`הקבלה החזירה שגיאה ${response.status}.`)
  return response.text()
}

function mapReceiptItem(record) {
  if (typeof record === 'string') return mapPlainTextRow(record)

  const name = textValue(firstValue(record, NAME_KEYS))
  if (!name) return null

  const externalId = textValue(firstValue(record, BARCODE_KEYS)) || stableReceiptId(name)
  return {
    external_id: externalId,
    barcode: textValue(firstValue(record, BARCODE_KEYS)),
    name,
    manufacturer: textValue(firstValue(record, MANUFACTURER_KEYS), ['name', 'title']),
    unit_qty: receiptUnit(record),
    picture_url: normalizeImageUrl(firstValue(record, IMAGE_KEYS)),
    quantity: receiptQuantity(record),
    store_id: textValue(firstValue(record, ['store_id', 'storeId', 'store'])),
    source_payload: record,
  }
}

function quantityFromDom(value) {
  if (/\b(?:ק"ג|קג|גרם|גר|ג)\b/.test(value)) return 1
  const quantity = asQuantity(value)
  return quantity || 1
}

function unitFromDom(value) {
  if (/\b(?:ק"ג|קג|גרם|גר|ג|מ"ל|מל|ליטר)\b/.test(value)) return value
  return null
}

function receiptQuantity(record) {
  const quantity = asQuantity(firstValue(record, QUANTITY_KEYS))
  if (quantity && quantity > 0) return quantity
  return 1
}

function receiptUnit(record) {
  const explicitUnit = textValue(firstValue(record, UNIT_KEYS.filter((key) => key !== 'weight')), ['text', 'name', 'value'])
  if (explicitUnit) return explicitUnit

  const weight = asQuantity(record?.weight)
  if (!weight) return textValue(firstValue(record, UNIT_KEYS), ['text', 'name', 'value'])
  if (weight >= 1000) return `${Number((weight / 1000).toFixed(3))} ק"ג`
  return `${weight} גרם`
}

function parsePlainTextRows(text) {
  return text
    .split(/\r?\n/)
    .map((row) => row.replace(/\s+/g, ' ').trim())
    .filter((row) => row.length > 3)
    .map(mapPlainTextRow)
    .filter(Boolean)
}

function mapPlainTextRow(row) {
  const cleaned = row.replace(/[₪$]\s*\d+([.,]\d+)?/g, '').trim()
  const barcode = cleaned.match(/\b\d{7,14}\b/)?.[0] || null
  const quantity = cleaned.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*(?:x|יח|קג|ק"ג|גרם)?(?:\s|$)/)?.[1]
  const unit = cleaned.match(/(\d+(?:[.,]\d+)?\s*(?:מ"ל|מל|ליטר|גרם|ק"ג|קג|יחידות|יח'))/)?.[1] || null
  const name = cleaned
    .replace(barcode || '', '')
    .replace(quantity || '', '')
    .replace(unit || '', '')
    .trim()

  if (!name || name.length < 2) return null

  return {
    external_id: barcode || stableReceiptId(name),
    barcode,
    name,
    manufacturer: null,
    unit_qty: unit,
    picture_url: null,
    quantity: asQuantity(quantity) || 1,
    source_payload: { raw: row },
  }
}

function looksLikePlainTextProduct(row) {
  if (!row || row.length < 4) return false
  if (/^(receipt|items|products|total|subtotal|vat)$/i.test(row)) return false
  if (/^\d+([.,]\d+)?$/.test(row)) return false
  return /[\u0590-\u05ff]/.test(row) && (/\b\d{7,14}\b/.test(row) || /\d/.test(row))
}

function extractJsonSnippets(content) {
  const snippets = []
  const matches = content.matchAll(/(?:window\.__NUXT__|window\.__INITIAL_STATE__|__NEXT_DATA__)\s*=?\s*({[\s\S]*?});?\s*$/g)
  for (const match of matches) snippets.push(match[1])

  const applicationJson = content.match(/{[\s\S]*}/)
  if (applicationJson) snippets.push(applicationJson[0])
  return snippets
}

function parseJson(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function firstValue(record, keys) {
  for (const key of keys) {
    if (record?.[key] !== undefined && record[key] !== null && record[key] !== '') return record[key]
  }
  return null
}

function textValue(value, nestedKeys = []) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
  if (typeof value !== 'object') return null

  for (const key of nestedKeys) {
    if (value[key] !== undefined && value[key] !== null && value[key] !== '') return String(value[key]).trim()
  }

  return null
}

function asQuantity(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object') return asQuantity(firstValue(value, ['quantity', 'qty', 'value', 'amount']))
  const parsed = Number(String(value).replace(',', '.').replace(/[^\d.]/g, ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function normalizeImageUrl(value) {
  if (!value) return null
  const image = String(value)
  if (image.startsWith('http://') || image.startsWith('https://')) return image
  if (image.startsWith('//')) return `https:${image}`
  if (image.startsWith('/')) return `https://www.rami-levy.co.il${image}`
  return image
}

function stableReceiptId(name) {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `receipt-${hash.toString(16)}`
}
