const ALLOWED_ORIGINS = new Set([
  'https://yahava1on.github.io',
])
const RECEIPT_HOSTS = new Set(['digi.rami-levy.co.il'])
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024
const MAX_AI_ITEMS = 60
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-lite-latest'
const BRIDGE_ENCRYPTION_CONTEXT = new TextEncoder().encode('groceries-receipt-bridge-v1')

type AiInput = {
  index: number
  raw_name: string
  current_name: string
  manufacturer: string
  unit_qty: string
  candidates: Array<{
    id: string
    name: string
    manufacturer: string
    unit_qty: string
  }>
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') || ''
  const corsHeaders = buildCorsHeaders(origin)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: isAllowedOrigin(origin) ? 204 : 403, headers: corsHeaders })
  }

  if (request.method !== 'POST') return response('Method not allowed', 405, corsHeaders)
  if (!isAllowedOrigin(origin)) return response('Origin not allowed', 403, corsHeaders)

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return response('Invalid JSON body', 400, corsHeaders)
  }

  try {
    if (body.action === 'receipt') return await fetchReceipt(body.url, corsHeaders)
    if (body.action === 'catalog') return await fetchCatalog(body.query, body.store, corsHeaders)
    if (body.action === 'normalize') return await normalizeItems(body.items, corsHeaders)
    return response('Unsupported action', 400, corsHeaders)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upstream request failed'
    return response(message, 502, corsHeaders)
  }
})

async function fetchReceipt(value: unknown, corsHeaders: HeadersInit) {
  if (typeof value !== 'string' || !value.trim()) return response('Missing receipt URL', 400, corsHeaders)

  let receiptUrl: URL
  try {
    receiptUrl = new URL(value)
  } catch {
    return response('Invalid receipt URL', 400, corsHeaders)
  }

  if (receiptUrl.protocol !== 'https:' || !RECEIPT_HOSTS.has(receiptUrl.hostname)) {
    return response('Receipt host is not allowed', 400, corsHeaders)
  }

  const bridgeUrl = Deno.env.get('RECEIPT_BRIDGE_URL')?.trim()
  const bridgeSecret = Deno.env.get('RECEIPT_BRIDGE_SECRET')?.trim()
  if (bridgeUrl && bridgeSecret) {
    return fetchReceiptFromBridge(receiptUrl, bridgeUrl, bridgeSecret, corsHeaders)
  }

  // Restore the original production scraper from 7b745f9. Rami Levy accepted
  // this small server request; later browser impersonation/API fallback logic
  // caused the deployed scraper to be rejected before parsing could begin.
  const upstream = await fetch(receiptUrl, {
    headers: {
      Accept: 'text/html,application/json,text/plain,*/*',
      'User-Agent': 'groceries-app-receipt-import/1.0',
    },
    signal: AbortSignal.timeout(15_000),
  })

  const declaredLength = Number(upstream.headers.get('content-length') || 0)
  if (declaredLength > MAX_RECEIPT_BYTES) return response('Receipt response is too large', 413, corsHeaders)

  const text = await upstream.text()
  if (new TextEncoder().encode(text).byteLength > MAX_RECEIPT_BYTES) {
    return response('Receipt response is too large', 413, corsHeaders)
  }

  return new Response(text, {
    status: upstream.status,
    headers: {
      ...corsHeaders,
      'Cache-Control': 'no-store',
      'Content-Type': upstream.headers.get('content-type') || 'text/plain; charset=utf-8',
    },
  })
}

async function fetchReceiptFromBridge(
  receiptUrl: URL,
  bridgeValue: string,
  bridgeSecret: string,
  corsHeaders: HeadersInit,
) {
  let bridgeUrl: URL
  try {
    bridgeUrl = new URL('/receipt', bridgeValue)
  } catch {
    return response('Receipt bridge URL is invalid', 503, corsHeaders)
  }
  if (bridgeUrl.protocol !== 'https:') return response('Receipt bridge must use HTTPS', 503, corsHeaders)

  const upstream = await fetch(bridgeUrl, {
    method: 'POST',
    headers: {
      Accept: 'text/html,application/json,text/plain,*/*',
      Authorization: `Bearer ${bridgeSecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(await encryptBridgePayload(JSON.stringify({ url: receiptUrl.toString() }), bridgeSecret)),
    signal: AbortSignal.timeout(30_000),
  })

  if (!upstream.ok) return response(`Receipt bridge returned ${upstream.status}`, 502, corsHeaders)

  let bridgeResponse: { status?: unknown; contentType?: unknown; text?: unknown }
  try {
    const envelope = await upstream.json()
    bridgeResponse = JSON.parse(await decryptBridgePayload(envelope, bridgeSecret))
  } catch {
    return response('Receipt bridge returned an invalid encrypted response', 502, corsHeaders)
  }

  const status = Number(bridgeResponse.status)
  const text = typeof bridgeResponse.text === 'string' ? bridgeResponse.text : ''
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    return response('Receipt bridge returned an invalid status', 502, corsHeaders)
  }
  if (new TextEncoder().encode(text).byteLength > MAX_RECEIPT_BYTES) {
    return response('Receipt response is too large', 413, corsHeaders)
  }

  return new Response(text, {
    status,
    headers: {
      ...corsHeaders,
      'Cache-Control': 'no-store',
      'Content-Type': typeof bridgeResponse.contentType === 'string'
        ? bridgeResponse.contentType
        : 'text/plain; charset=utf-8',
    },
  })
}

async function encryptBridgePayload(value: string, secret: string) {
  const key = await bridgeEncryptionKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: BRIDGE_ENCRYPTION_CONTEXT },
    key,
    new TextEncoder().encode(value),
  )
  return { iv: toBase64Url(iv), data: toBase64Url(new Uint8Array(encrypted)) }
}

async function decryptBridgePayload(value: unknown, secret: string) {
  if (!value || typeof value !== 'object') throw new Error('Invalid encrypted value')
  const envelope = value as { iv?: unknown; data?: unknown }
  if (typeof envelope.iv !== 'string' || typeof envelope.data !== 'string') {
    throw new Error('Invalid encrypted value')
  }
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(envelope.iv), additionalData: BRIDGE_ENCRYPTION_CONTEXT },
    await bridgeEncryptionKey(secret),
    fromBase64Url(envelope.data),
  )
  return new TextDecoder().decode(decrypted)
}

async function bridgeEncryptionKey(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

function toBase64Url(value: Uint8Array) {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function fetchCatalog(queryValue: unknown, storeValue: unknown, corsHeaders: HeadersInit) {
  const query = typeof queryValue === 'string' ? queryValue.trim() : ''
  const store = typeof storeValue === 'string' && /^\d{1,8}$/.test(storeValue) ? storeValue : '331'
  if (!query || query.length > 200) return response('Invalid catalog query', 400, corsHeaders)

  const upstream = await fetch('https://www.rami-levy.co.il/api/catalog?', {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json;charset=UTF-8',
      'User-Agent': 'groceries-app-catalog-match/1.0',
      locale: 'he',
      origin: 'https://www.rami-levy.co.il',
      referer: 'https://www.rami-levy.co.il/he',
    },
    body: JSON.stringify({ q: query, aggs: 1, store }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!upstream.ok && /^\d{7,14}$/.test(query)) {
    const fallback = await fetchOpenFoodFacts(query, corsHeaders)
    if (fallback) return fallback
  }

  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      ...corsHeaders,
      'Cache-Control': 'no-store',
      'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    },
  })
}

async function fetchOpenFoodFacts(barcode: string, corsHeaders: HeadersInit) {
  const fields = 'code,product_name_he,product_name,brands,quantity,image_front_url,image_url'
  const upstream = await fetch(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${fields}`,
    {
      headers: { Accept: 'application/json', 'User-Agent': 'groceries-app/1.0 (receipt metadata fallback)' },
      signal: AbortSignal.timeout(15_000),
    }
  )
  if (!upstream.ok) return null

  const payload = await upstream.json()
  const product = payload?.product
  const name = product?.product_name_he || product?.product_name
  if (payload?.status !== 1 || !product || !name) return null

  const mapped = {
    code: String(product.code || barcode),
    name: String(name),
    manufacturer: String(product.brands || ''),
    unitQty: String(product.quantity || ''),
    imageUrl: String(product.image_front_url || product.image_url || ''),
    source: 'open_food_facts',
  }

  return new Response(JSON.stringify({ products: [mapped] }), {
    headers: {
      ...corsHeaders,
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}

async function normalizeItems(value: unknown, corsHeaders: HeadersInit) {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) return response('Gemini is not configured', 503, corsHeaders)
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_AI_ITEMS) {
    return response(`Expected between 1 and ${MAX_AI_ITEMS} items`, 400, corsHeaders)
  }

  const items = value.map(normalizeAiInput).filter((item): item is AiInput => item !== null)
  if (items.length !== value.length) return response('Invalid normalization input', 400, corsHeaders)

  const geminiResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: normalizationPrompt(items) }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseJsonSchema: normalizationSchema(),
        },
      }),
      signal: AbortSignal.timeout(30_000),
    }
  )

  if (!geminiResponse.ok) {
    const errorText = (await geminiResponse.text()).slice(0, 500)
    throw new Error(`Gemini returned ${geminiResponse.status}: ${errorText}`)
  }

  const geminiPayload = await geminiResponse.json()
  const outputText = geminiPayload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('')
  if (!outputText) throw new Error('Gemini returned an empty response')

  let output: unknown
  try {
    output = JSON.parse(outputText)
  } catch {
    throw new Error('Gemini returned invalid JSON')
  }

  const normalized = validateAiOutput(output, items)
  return new Response(JSON.stringify({ items: normalized }), {
    headers: { ...corsHeaders, 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function normalizeAiInput(value: unknown): AiInput | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const index = Number(item.index)
  const rawName = cleanString(item.raw_name, 300)
  const currentName = cleanString(item.current_name, 300)
  if (!Number.isInteger(index) || index < 0 || !rawName || !currentName) return null

  return {
    index,
    raw_name: rawName,
    current_name: currentName,
    manufacturer: cleanString(item.manufacturer, 120),
    unit_qty: cleanString(item.unit_qty, 120),
    candidates: normalizeCandidates(item.candidates),
  }
}

function normalizeCandidates(value: unknown): AiInput['candidates'] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 5).flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return []
    const record = candidate as Record<string, unknown>
    const id = cleanString(record.id, 100)
    const name = cleanString(record.name, 300)
    if (!id || !name) return []
    return [{
      id,
      name,
      manufacturer: cleanString(record.manufacturer, 120),
      unit_qty: cleanString(record.unit_qty, 120),
    }]
  })
}

function normalizationPrompt(items: AiInput[]) {
  return [
    'You normalize Israeli grocery receipt items. Product names and manufacturers must always be written in Hebrew.',
    'Translate generic product words to Hebrew and transliterate foreign brand names into their commonly used Hebrew spelling.',
    'Correct OCR mistakes and remove retailer/internal codes from names.',
    'Each item may include candidates from the existing foods database.',
    'Choose matched_food_id when a candidate represents the same real product despite spelling errors, word order, abbreviations, or a clearly incorrect receipt unit.',
    'Do not match merely because products share a broad category. Different brands, flavors, fat percentages, or package variants are different products.',
    'When choosing a candidate, copy its exact id into matched_food_id. Otherwise return an empty string.',
    'Classify is_food as true only for food or drink intended for human consumption.',
    'Cleaning products, cosmetics, hygiene products, paper goods, kitchen supplies, balloons, and other household items are not food.',
    'food_confidence is the independent confidence in that food/non-food classification.',
    'Preserve meaningful product variants such as scent, fat percentage, or package type.',
    'Manufacturer must represent only a supplied manufacturer or an explicit brand in the supplied names, but write it in Hebrew.',
    'Never substitute a different brand and never change the product category (for example milk must remain milk, not yogurt).',
    'unit_qty must contain at most one number and one Hebrew unit label.',
    'Convert multipacks to one total measurement: for example 9x100 grams becomes 900 גרם, never 100 גרם, 9x100.',
    'When no measurement exists, or it is zero, return יחידה.',
    'The numeric measurement must come from the supplied text or arithmetic on supplied multipack numbers. Correct the unit label when the supplied unit is physically impossible.',
    'Use physical common sense to correct an obviously corrupted unit: solid produce such as bananas is measured in grams or kilograms, never milliliters; liquids use milliliters or liters.',
    'Never guess a missing manufacturer. Use an empty manufacturer string when it cannot be established.',
    'Confidence is 0 to 1 and must be below 0.7 whenever a fact is uncertain.',
    'Keep every input index exactly once and do not add products.',
    JSON.stringify(items),
  ].join('\n')
}

function normalizationSchema() {
  return {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            name: { type: 'string' },
            manufacturer: { type: 'string' },
            unit_qty: { type: 'string' },
            matched_food_id: { type: 'string' },
            is_food: { type: 'boolean' },
            food_confidence: { type: 'number', minimum: 0, maximum: 1 },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['index', 'name', 'manufacturer', 'unit_qty', 'matched_food_id', 'is_food', 'food_confidence', 'confidence'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  }
}

function validateAiOutput(value: unknown, inputs: AiInput[]) {
  if (!value || typeof value !== 'object' || !Array.isArray((value as Record<string, unknown>).items)) {
    throw new Error('Gemini response did not contain items')
  }

  const expectedLength = inputs.length
  const seen = new Set<number>()
  const items = ((value as { items: Array<Record<string, unknown>> }).items).map((item) => {
    const index = Number(item.index)
    const confidence = Number(item.confidence)
    const foodConfidence = Number(item.food_confidence)
    const isFood = typeof item.is_food === 'boolean' ? item.is_food : true
    const name = cleanString(item.name, 300)
    if (!Number.isInteger(index) || index < 0 || index >= expectedLength || seen.has(index) || !name) {
      throw new Error('Gemini returned an invalid item index or name')
    }
    seen.add(index)
    const input = inputs[index]
    const requestedMatchId = cleanString(item.matched_food_id, 100)
    const matchedCandidate = input.candidates.find((candidate) => candidate.id === requestedMatchId)
    if (matchedCandidate) {
      const evidence = `${input.raw_name} ${input.current_name} ${input.manufacturer} ${input.unit_qty}`
      const aiName = cleanString(item.name, 300)
      const aiManufacturer = supportedManufacturer(cleanString(item.manufacturer, 120), evidence, input.manufacturer)
      const aiUnit = supportedUnit(cleanString(item.unit_qty, 120), evidence)
      return {
        index,
        name: containsHebrew(aiName) ? aiName : matchedCandidate.name,
        manufacturer: containsHebrew(aiManufacturer.value)
          ? aiManufacturer.value
          : matchedCandidate.manufacturer || aiManufacturer.value,
        unit_qty: singleUnitQty(aiUnit.value || matchedCandidate.unit_qty),
        matched_food_id: matchedCandidate.id,
        is_food: isFood,
        food_confidence: Number.isFinite(foodConfidence) ? Math.max(0, Math.min(1, foodConfidence)) : 0,
        confidence: Number.isFinite(confidence) && aiManufacturer.supported && aiUnit.supported
          ? Math.max(0, Math.min(1, confidence))
          : 0.49,
      }
    }

    const evidence = `${input.raw_name} ${input.current_name} ${input.manufacturer} ${input.unit_qty}`
    const nameEvidence = `${input.raw_name} ${input.current_name}`
    const nameIsSupported = hasWordOverlap(name, nameEvidence) || (containsHebrew(name) && containsLatin(nameEvidence))
    const manufacturer = supportedManufacturer(cleanString(item.manufacturer, 120), evidence, input.manufacturer)
    const unitQty = supportedUnit(cleanString(item.unit_qty, 120), evidence)
    const safeConfidence = nameIsSupported && manufacturer.supported && unitQty.supported
      ? confidence
      : Math.min(confidence, 0.49)

    return {
      index,
      name: nameIsSupported ? name : input.current_name,
      manufacturer: manufacturer.value,
      unit_qty: singleUnitQty(unitQty.value),
      matched_food_id: '',
      is_food: isFood,
      food_confidence: Number.isFinite(foodConfidence) ? Math.max(0, Math.min(1, foodConfidence)) : 0,
      confidence: Number.isFinite(safeConfidence) ? Math.max(0, Math.min(1, safeConfidence)) : 0,
    }
  })

  if (items.length !== expectedLength || seen.size !== expectedLength) throw new Error('Gemini omitted receipt items')
  return items
}

function hasWordOverlap(candidate: string, evidence: string) {
  const candidateWords = meaningfulWords(candidate)
  const evidenceWords = meaningfulWords(evidence)
  return candidateWords.some((word) => evidenceWords.some((evidenceWord) => wordSimilarity(word, evidenceWord) >= 0.72))
}

function wordSimilarity(left: string, right: string) {
  if (left === right) return 1
  const longest = Math.max(left.length, right.length)
  if (!longest) return 1
  return 1 - levenshteinDistance(left, right) / longest
}

function levenshteinDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0]
    previous[0] = leftIndex
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex]
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1
      previous[rightIndex] = Math.min(previous[rightIndex] + 1, previous[rightIndex - 1] + 1, diagonal + cost)
      diagonal = above
    }
  }
  return previous[right.length]
}

function meaningfulWords(value: string) {
  return normalizeForCompare(value)
    .split(' ')
    .filter((word) => word.length >= 2 && !/^\d+(?:[.,]\d+)?%?$/.test(word))
}

function supportedManufacturer(value: string, evidence: string, suppliedManufacturer: string) {
  if (!value) return { value: '', supported: true }
  const normalizedValue = normalizeForCompare(value)
  const normalizedEvidence = normalizeForCompare(evidence)
  const normalizedSupplied = normalizeForCompare(suppliedManufacturer)
  const supported = normalizedValue === normalizedSupplied || normalizedEvidence.includes(normalizedValue) ||
    (containsHebrew(value) && containsLatin(evidence))
  return { value: supported ? value : '', supported }
}

function supportedUnit(value: string, evidence: string) {
  if (!value || value === 'יחידה') return { value: 'יחידה', supported: true }
  const numbers = value.match(/\d+(?:[.,]\d+)?/g) || []
  const normalizedEvidence = normalizeForCompare(evidence)
  const evidenceNumbers = (normalizedEvidence.match(/\d+(?:\.\d+)?/g) || []).map(Number)
  const supported = numbers.every((number) => {
    const target = Number(number.replace(',', '.'))
    return evidenceNumbers.includes(target) || evidenceNumbers.some((left) => evidenceNumbers.some((right) => left * right === target))
  })
  return { value: supported ? value : '', supported }
}

function singleUnitQty(value: string) {
  const text = cleanString(value, 120)
  if (!text || /^0(?:[.,]0+)?(?:\s|$)/.test(text)) return 'יחידה'

  const multipack = text.match(/(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*(מ["״]?ל|מיליליטר|ליטר|גרם|גר|ג|ק["״]?ג|קג)?/i)
  if (multipack) {
    const total = Number(multipack[1].replace(',', '.')) * Number(multipack[2].replace(',', '.'))
    const unit = normalizeHebrewUnit(multipack[3])
    return unit ? `${formatAmount(total)} ${unit}` : `${formatAmount(total)} יחידות`
  }

  const measurement = text.match(/(\d+(?:[.,]\d+)?)\s*(מ["״]?ל|מיליליטר|ליטר|גרם|גר|ג|ק["״]?ג|קג|יחידות|יחידה|יח[׳'])/i)
  if (measurement) {
    const amount = Number(measurement[1].replace(',', '.'))
    if (!amount) return 'יחידה'
    const unit = normalizeHebrewUnit(measurement[2]) || 'יחידות'
    return `${formatAmount(amount)} ${unit}`
  }

  const number = Number(text.match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(',', '.'))
  return Number.isFinite(number) && number > 0 ? `${formatAmount(number)} יחידות` : 'יחידה'
}

function normalizeHebrewUnit(value = '') {
  if (/^(?:מ["״]?ל|מיליליטר)$/i.test(value)) return 'מ״ל'
  if (/^ליטר$/i.test(value)) return 'ליטר'
  if (/^(?:גרם|גר|ג)$/i.test(value)) return 'גרם'
  if (/^(?:ק["״]?ג|קג)$/i.test(value)) return 'ק״ג'
  if (/^(?:יחידות|יחידה|יח[׳'])$/i.test(value)) return 'יחידות'
  return ''
}

function formatAmount(value: number) {
  return String(Number(value.toFixed(3)))
}

function containsHebrew(value: string) {
  return /[\u0590-\u05ff]/.test(value)
}

function containsLatin(value: string) {
  return /[a-z]/i.test(value)
}

function normalizeForCompare(value: string) {
  return value
    .toLocaleLowerCase('he')
    .replace(/[,]/g, '.')
    .replace(/[^\p{L}\p{N}%.]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function isAllowedOrigin(origin: string) {
  if (ALLOWED_ORIGINS.has(origin)) return true
  try {
    const url = new URL(origin)
    return (url.hostname === 'localhost' || url.hostname === '127.0.0.1') && ['http:', 'https:'].includes(url.protocol)
  } catch {
    return false
  }
}

function buildCorsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Headers': 'apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : 'null',
    Vary: 'Origin',
  }
}

function response(body: string, status: number, corsHeaders: HeadersInit) {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
