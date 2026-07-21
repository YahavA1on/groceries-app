const ALLOWED_ORIGINS = new Set(['https://yahava1on.github.io'])
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-lite-latest'
const MAX_INVENTORY_ITEMS = 80
const MAX_RECIPES = 8
const MAX_PAGE_BYTES = 1_500_000

type InventoryItem = {
  food_id: string
  name: string
  manufacturer: string
  unit_qty: string
  category: string
  quantity: number
}

type RecipeCandidate = {
  external_key: string
  title: string
  source_name: string
  source_url: string
  rating: number
  reviews: number
  total_time_minutes: number
  image_url: string
  servings: number
  ingredient_lines: string[]
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') || ''
  const corsHeaders = buildCorsHeaders(origin)
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: isAllowedOrigin(origin) ? 204 : 403, headers: corsHeaders })
  }
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  if (!isAllowedOrigin(origin)) return jsonResponse({ error: 'Origin not allowed' }, 403, corsHeaders)

  let body: { session_token?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders)
  }
  const sessionToken = cleanString(body.session_token, 500)
  if (!sessionToken) return jsonResponse({ error: 'Missing session token' }, 400, corsHeaders)

  try {
    const inventory = await callRpc<InventoryItem[]>('get_recipe_inventory_context', {
      p_session_token: sessionToken,
    })
    if (!Array.isArray(inventory) || inventory.length === 0) {
      return jsonResponse({ recipes: 0, reason: 'EMPTY_INVENTORY' }, 200, corsHeaders)
    }

    const candidates = await searchHebrewRecipes(inventory)
    if (candidates.length === 0) {
      return jsonResponse({ recipes: 0, reason: 'NO_RESULTS' }, 200, corsHeaders)
    }

    const recipes = await normalizeRecipes(candidates, inventory.slice(0, MAX_INVENTORY_ITEMS))
    const saved = await callRpc<number>('cache_family_recipe_suggestions', {
      p_session_token: sessionToken,
      p_recipes: recipes,
    })
    return jsonResponse({ recipes: Number(saved || 0) }, 200, corsHeaders)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Recipe search failed'
    return jsonResponse({ error: message }, 502, corsHeaders)
  }
})

async function searchHebrewRecipes(inventory: InventoryItem[]) {
  const apiKey = Deno.env.get('SERPAPI_KEY')?.trim()
  if (!apiKey) throw new Error('SerpApi is not configured')

  const searchTerms = inventory
    .filter((item) => item.name && !/מים|water/i.test(item.name))
    .slice(0, 5)
    .map((item) => genericFoodName(item.name))
    .filter(Boolean)
  const query = `מתכונים עם ${searchTerms.slice(0, 4).join(' ')}`
  const url = new URL('https://serpapi.com/search.json')
  url.searchParams.set('engine', 'google')
  url.searchParams.set('q', query)
  url.searchParams.set('hl', 'he')
  url.searchParams.set('gl', 'il')
  url.searchParams.set('location', 'Israel')
  url.searchParams.set('api_key', apiKey)

  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`SerpApi returned ${response.status}`)
  const payload = await response.json()
  if (payload?.error) throw new Error(`SerpApi: ${String(payload.error).slice(0, 300)}`)

  const results = Array.isArray(payload?.recipes_results) ? payload.recipes_results : []
  const baseCandidates = results.flatMap((result: Record<string, unknown>) => {
    const rating = Number(result.rating)
    const sourceUrl = cleanString(result.link, 2000)
    const totalTime = parseDurationMinutes(result.total_time)
    if (!sourceUrl || rating < 4 || !totalTime) return []
    return [{
      title: cleanString(result.title, 300),
      source_name: cleanString(result.source, 200) || 'מקור המתכון',
      source_url: sourceUrl,
      rating,
      reviews: Math.max(0, Number(result.reviews) || 0),
      total_time_minutes: totalTime,
      image_url: cleanString(result.thumbnail, 2000),
      fallback_ingredients: Array.isArray(result.ingredients)
        ? result.ingredients.map((item: unknown) => cleanString(item, 300)).filter(Boolean)
        : [],
    }]
  }).slice(0, MAX_RECIPES)

  const detailed = await Promise.all(baseCandidates.map(async (candidate) => {
    try {
      const structured = await fetchStructuredRecipe(candidate.source_url)
      if (!structured) return null
      const rating = Number(structured.aggregateRating?.ratingValue) || candidate.rating
      const totalTime = parseDurationMinutes(structured.totalTime)
        || parseDurationMinutes(structured.prepTime) + parseDurationMinutes(structured.cookTime)
        || candidate.total_time_minutes
      const ingredients = Array.isArray(structured.recipeIngredient)
        ? structured.recipeIngredient.map((item: unknown) => cleanString(item, 500)).filter(Boolean)
        : candidate.fallback_ingredients
      if (rating < 4 || !totalTime || ingredients.length === 0) return null
      return {
        external_key: await sha256(candidate.source_url),
        title: cleanString(structured.name, 300) || candidate.title,
        source_name: candidate.source_name,
        source_url: candidate.source_url,
        rating: Math.min(5, rating),
        reviews: Math.max(0, Number(structured.aggregateRating?.ratingCount || structured.aggregateRating?.reviewCount) || candidate.reviews),
        total_time_minutes: totalTime,
        image_url: structuredImage(structured.image) || candidate.image_url,
        servings: parseServings(structured.recipeYield),
        ingredient_lines: ingredients.slice(0, 40),
      } satisfies RecipeCandidate
    } catch {
      return null
    }
  }))

  return detailed.filter((candidate): candidate is RecipeCandidate => candidate !== null)
}

async function fetchStructuredRecipe(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || unsafeHostname(url.hostname)) throw new Error('Unsafe recipe URL')
  const response = await fetch(url, {
    headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'groceries-app-recipe-reader/1.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`Recipe page returned ${response.status}`)
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > MAX_PAGE_BYTES) throw new Error('Recipe page is too large')
  const html = (await response.text()).slice(0, MAX_PAGE_BYTES)
  const scripts = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1].trim()))
      const recipe = findRecipeNode(parsed)
      if (recipe) return recipe
    } catch {
      // Continue to the next JSON-LD block.
    }
  }
  return null
}

function findRecipeNode(value: unknown): Record<string, any> | null {
  if (Array.isArray(value)) {
    for (const child of value) {
      const recipe = findRecipeNode(child)
      if (recipe) return recipe
    }
    return null
  }
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, any>
  const types = Array.isArray(record['@type']) ? record['@type'] : [record['@type']]
  if (types.some((type) => String(type).toLowerCase() === 'recipe')) return record
  for (const key of ['@graph', 'mainEntity', 'itemListElement']) {
    const recipe = findRecipeNode(record[key])
    if (recipe) return recipe
  }
  return null
}

async function normalizeRecipes(candidates: RecipeCandidate[], inventory: InventoryItem[]) {
  const apiKey = Deno.env.get('GEMINI_API_KEY')?.trim()
  if (!apiKey) throw new Error('Gemini is not configured')
  const prompt = [
    'You map Hebrew recipe ingredients to an Israeli household grocery inventory.',
    'Return every recipe and every ingredient in the original order.',
    'Keep recipe titles and ingredient names in clear Hebrew.',
    'For each ingredient, match food_id only to the exact compatible inventory product.',
    'Brand differences may be ignored for generic cooking ingredients, but do not match different foods or flavors.',
    'Convert the required recipe amount into the number of inventory packages represented by inventory.unit_qty.',
    'Example: 500 grams required and a matched 1 kilogram package means inventory_quantity_required=0.5.',
    'If inventory.unit_qty is יחידה, match a recipe count directly to inventory units.',
    'If the conversion cannot be calculated safely, return an empty food_id and inventory_quantity_required=0.',
    'Never invent an amount that is absent from required_text.',
    'Mark ingredients explicitly described as optional as optional=true.',
    'Do not omit salt, spices, oil, sauces, creams, or other cooking ingredients.',
    JSON.stringify({ recipes: candidates, inventory }),
  ].join('\n')

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseJsonSchema: recipeSchema(),
        },
      }),
      signal: AbortSignal.timeout(45_000),
    },
  )
  if (!response.ok) throw new Error(`Gemini returned ${response.status}: ${(await response.text()).slice(0, 300)}`)
  const payload = await response.json()
  const outputText = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('')
  if (!outputText) throw new Error('Gemini returned an empty recipe response')
  const output = JSON.parse(outputText)
  const normalized = Array.isArray(output?.recipes) ? output.recipes : []
  const inventoryIds = new Set(inventory.map((item) => item.food_id))

  return candidates.flatMap((candidate, index) => {
    const result = normalized.find((item: Record<string, unknown>) => Number(item.recipe_index) === index)
    if (!result || !Array.isArray(result.ingredients)) return []
    const ingredients = result.ingredients.slice(0, 40).map((item: Record<string, unknown>) => {
      const foodId = cleanString(item.food_id, 100)
      const requiredQuantity = Number(item.inventory_quantity_required)
      return {
        name: cleanString(item.name, 200),
        required_text: cleanString(item.required_text, 500),
        food_id: inventoryIds.has(foodId) && requiredQuantity > 0 ? foodId : '',
        inventory_quantity_required: inventoryIds.has(foodId) && requiredQuantity > 0 ? requiredQuantity : 0,
        optional: Boolean(item.optional),
      }
    })
    if (ingredients.length === 0) return []
    return [{
      ...candidate,
      title: cleanString(result.title, 300) || candidate.title,
      ingredient_lines: undefined,
      ingredients,
    }]
  })
}

function recipeSchema() {
  return {
    type: 'object',
    properties: {
      recipes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            recipe_index: { type: 'integer', minimum: 0 },
            title: { type: 'string' },
            ingredients: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  required_text: { type: 'string' },
                  food_id: { type: 'string' },
                  inventory_quantity_required: { type: 'number', minimum: 0 },
                  optional: { type: 'boolean' },
                },
                required: ['name', 'required_text', 'food_id', 'inventory_quantity_required', 'optional'],
                additionalProperties: false,
              },
            },
          },
          required: ['recipe_index', 'title', 'ingredients'],
          additionalProperties: false,
        },
      },
    },
    required: ['recipes'],
    additionalProperties: false,
  }
}

async function callRpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) throw new Error('Supabase function environment is incomplete')
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`Recipe database request failed (${response.status})`)
  return await response.json() as T
}

function parseDurationMinutes(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value))
  const text = cleanString(value, 100)
  if (!text) return 0
  const iso = text.match(/^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?/i)
  if (iso) return Number(iso[1] || 0) * 60 + Number(iso[2] || 0)
  const hours = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|שעות?|שעה)/i)?.[1] || 0)
  const minutes = Number(text.match(/(\d+)\s*(?:minutes?|mins?|דקות?|דקה)/i)?.[1] || 0)
  if (hours || minutes) return Math.round(hours * 60 + minutes)
  const bare = Number(text.match(/\d+/)?.[0] || 0)
  return Number.isFinite(bare) ? bare : 0
}

function parseServings(value: unknown) {
  const text = Array.isArray(value) ? value.join(' ') : cleanString(value, 100)
  return Math.max(0, Number(String(text).match(/\d+(?:\.\d+)?/)?.[0] || 0))
}

function structuredImage(value: unknown) {
  if (typeof value === 'string') return cleanString(value, 2000)
  if (Array.isArray(value)) return structuredImage(value[0])
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return cleanString(record.url || record.contentUrl, 2000)
  }
  return ''
}

function genericFoodName(value: string) {
  return value.replace(/\b\d+(?:[.,]\d+)?\b/g, '').replace(/[×x]\s*\d+/gi, '').replace(/\s+/g, ' ').trim()
}

function unsafeHostname(hostname: string) {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host.endsWith('.local') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')
}

function decodeHtml(value: string) {
  return value.replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function cleanString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : ''
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

function buildCorsHeaders(origin: string): HeadersInit {
  return {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : 'https://yahava1on.github.io',
    Vary: 'Origin',
  }
}

function jsonResponse(value: unknown, status: number, corsHeaders: HeadersInit) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...corsHeaders, 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' },
  })
}
