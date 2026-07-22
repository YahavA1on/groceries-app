const ALLOWED_ORIGINS = new Set(['https://yahava1on.github.io'])
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-lite-latest'
const MAX_INVENTORY_ITEMS = 80
const MAX_RECIPES = 8
const MAX_SEARCH_CANDIDATES = 20
const MIN_CATALOG_RECIPES = 5
const MAX_PAGE_BYTES = 1_500_000
const SALAD_PATTERN = /סלט|salad/i
const NON_FOOD_PATTERN = /פדים|איפור|שמפו|מרכך|סבון|חיתולים|מגבונים|שקיות|נייר|בלונים|אקונומיקה|כביסה|דאודורנט|משחת\s*שיניים|כלים\s*חד|פיקדון|פקדון|(?:^|\s)מים(?:\s|$)|shampoo|soap|cleaner|detergent|cosmetic|balloons?/i

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

type SearchCandidate = Omit<RecipeCandidate, 'external_key' | 'servings' | 'ingredient_lines'> & {
  fallback_ingredients: string[]
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
    const inventory = await callRpcWithFallback<InventoryItem[]>(
      'get_enabled_recipe_inventory_context',
      'get_recipe_inventory_context',
      { p_session_token: sessionToken },
    )
    if (!Array.isArray(inventory) || inventory.length === 0) {
      return jsonResponse({ recipes: 0, reason: 'EMPTY_INVENTORY' }, 200, corsHeaders)
    }

    const sharedCatalog = await callOptionalRpc<RecipeCandidate[]>('list_shared_recipe_catalog', {
      p_session_token: sessionToken,
    }, true) || []
    let candidates = rankCatalogCandidates(sharedCatalog, inventory).slice(0, MAX_RECIPES)
    let externalSearches = 0

    if (candidates.length < MIN_CATALOG_RECIPES) {
      const searchKey = await inventoryRecipeSearchKey(inventory)
      const claimed = searchKey
        ? await callOptionalRpc<boolean>('claim_shared_recipe_search', {
          p_session_token: sessionToken,
          p_search_key: searchKey,
        }, true)
        : false
      if (claimed) {
        const searchQuery = await planRecipeSearch(inventory)
        const searched = await searchHebrewRecipes(searchQuery)
        externalSearches = 1
        await callRpc<number>('cache_shared_recipe_catalog', {
          p_session_token: sessionToken,
          p_search_key: searchKey,
          p_recipes: searched,
        }, true)
        candidates = uniqueRecipeCandidates([...candidates, ...searched]).slice(0, MAX_RECIPES)
      }
    }
    console.log(JSON.stringify({ event: 'recipe_candidates_ready', count: candidates.length }))
    if (candidates.length === 0) {
      return jsonResponse({ recipes: 0, reason: 'CATALOG_EMPTY', external_searches: externalSearches }, 200, corsHeaders)
    }

    const recipes = await normalizeRecipes(candidates, inventory.slice(0, MAX_INVENTORY_ITEMS))
    console.log(JSON.stringify({ event: 'recipes_normalized', count: recipes.length }))
    const saved = await callRpcWithFallback<number>(
      'cache_enabled_family_recipe_suggestions',
      'cache_family_recipe_suggestions',
      { p_session_token: sessionToken, p_recipes: recipes },
    )
    return jsonResponse({ recipes: Number(saved || 0), external_searches: externalSearches }, 200, corsHeaders)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Recipe search failed'
    return jsonResponse({ error: message }, 502, corsHeaders)
  }
})

async function searchHebrewRecipes(query: string) {
  const apiKey = Deno.env.get('SERPAPI_KEY')?.trim()
  if (!apiKey) throw new Error('SerpApi is not configured')
  const baseCandidates = await fetchSerpCandidates(query, apiKey)
  console.log(JSON.stringify({ event: 'recipe_search_results', query, candidates: baseCandidates.length }))
  const enriched = await Promise.all(baseCandidates.map(enrichRecipeCandidate))
  const validRecipes = enriched.filter((candidate): candidate is RecipeCandidate => (
    candidate !== null && isUsableRecipeCandidate(candidate) && !SALAD_PATTERN.test(candidate.title)
  ))
  console.log(JSON.stringify({ event: 'recipe_pages_validated', query, valid: validRecipes.length }))
  return validRecipes.slice(0, MAX_RECIPES)
}

async function planRecipeSearch(inventory: InventoryItem[]) {
  const fallbackQuery = buildRecipeSearchQuery(inventory)
  const apiKey = Deno.env.get('GEMINI_API_KEY')?.trim()
  if (!apiKey) return fallbackQuery

  const usableInventory = inventory
    .filter((item) => item.name
      && !NON_FOOD_PATTERN.test(`${item.name} ${item.manufacturer || ''}`)
      && !SALAD_PATTERN.test(item.name))
    .sort((a, b) => recipeSearchPriority(a) - recipeSearchPriority(b))
    .slice(0, 40)
    .map((item) => ({
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      unit_qty: item.unit_qty,
    }))

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: [
            'Suggest exactly 8 diverse Hebrew main-dish names based on this household inventory.',
            'Use the strongest main ingredients first and prefer dishes that use several available products.',
            'If minced or ground meat exists, include several genuinely different meat dishes such as baked, stuffed, pasta, meatballs, or pastry dishes.',
            'Do not suggest salads, mashed vegetables, side dishes, drinks, desserts, or near-duplicate dishes.',
            'The dish names must be common enough to find real Hebrew recipes on Google.',
            'Return dish names only in the requested JSON structure. Do not invent ratings, URLs, or recipe details.',
            JSON.stringify(usableInventory),
          ].join('\n') }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
            responseJsonSchema: {
              type: 'object',
              properties: {
                dishes: {
                  type: 'array',
                  minItems: 5,
                  maxItems: 8,
                  items: { type: 'string' },
                },
              },
              required: ['dishes'],
              additionalProperties: false,
            },
          },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    )
    if (!response.ok) throw new Error(`Gemini planning returned ${response.status}`)
    const payload = await response.json()
    const outputText = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('')
    const output = outputText ? JSON.parse(outputText) : null
    const dishes = uniqueDishNames(output?.dishes)
    if (dishes.length < MIN_CATALOG_RECIPES) return fallbackQuery
    console.log(JSON.stringify({ event: 'recipe_search_planned', dishes: dishes.length }))
    return buildDishSearchQuery(dishes)
  } catch (error) {
    console.log(JSON.stringify({
      event: 'recipe_search_plan_failed',
      error: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
    }))
    return fallbackQuery
  }
}

async function fetchSerpCandidates(query: string, apiKey: string): Promise<SearchCandidate[]> {
  const url = new URL('https://serpapi.com/search.json')
  url.searchParams.set('engine', 'google')
  url.searchParams.set('q', query)
  url.searchParams.set('hl', 'he')
  url.searchParams.set('gl', 'il')
  url.searchParams.set('location', 'Israel')
  url.searchParams.set('num', String(MAX_SEARCH_CANDIDATES))
  url.searchParams.set('api_key', apiKey)

  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`SerpApi returned ${response.status}`)
  const payload = await response.json()
  if (payload?.error) throw new Error(`SerpApi: ${String(payload.error).slice(0, 300)}`)

  const recipeResults = Array.isArray(payload?.recipes_results) ? payload.recipes_results : []
  const organicResults = Array.isArray(payload?.organic_results) ? payload.organic_results : []
  const candidates = recipeResults.flatMap((result: Record<string, unknown>) => {
    const parsedRating = Number(result.rating)
    const sourceUrl = cleanString(result.link, 2000)
    const totalTime = parseDurationMinutes(result.total_time)
    if (!validRecipeSourceUrl(sourceUrl)) return []
    return [{
      title: cleanString(result.title, 300),
      source_name: cleanString(result.source, 200) || 'מקור המתכון',
      source_url: sourceUrl,
      rating: Number.isFinite(parsedRating) ? parsedRating : 0,
      reviews: Math.max(0, Number(result.reviews) || 0),
      total_time_minutes: totalTime,
      image_url: cleanString(result.thumbnail, 2000),
      fallback_ingredients: Array.isArray(result.ingredients)
        ? result.ingredients.map((item: unknown) => cleanString(item, 300)).filter(Boolean)
        : [],
    }]
  })
  candidates.push(...organicResults.flatMap((result: Record<string, unknown>) => {
    const sourceUrl = cleanString(result.link, 2000)
    if (!validRecipeSourceUrl(sourceUrl)) return []
    let sourceName = cleanString(result.source, 200) || cleanString(result.displayed_link, 200)
    try {
      sourceName ||= new URL(sourceUrl).hostname.replace(/^www\./, '')
    } catch {
      sourceName ||= 'מקור המתכון'
    }
    return [{
      title: cleanString(result.title, 300),
      source_name: sourceName,
      source_url: sourceUrl,
      rating: 0,
      reviews: 0,
      total_time_minutes: 0,
      image_url: cleanString(result.thumbnail, 2000),
      fallback_ingredients: [],
    }]
  }))
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    if (SALAD_PATTERN.test(candidate.title)) return false
    if (seen.has(candidate.source_url)) return false
    seen.add(candidate.source_url)
    return true
  }).slice(0, MAX_SEARCH_CANDIDATES)
}

async function enrichRecipeCandidate(candidate: SearchCandidate): Promise<RecipeCandidate | null> {
  try {
    const structured = await fetchStructuredRecipe(candidate.source_url)
    if (!structured) {
      console.log(JSON.stringify({ event: 'recipe_page_missing_structured_data', host: new URL(candidate.source_url).hostname }))
      return null
    }
    const structuredRating = Number(structured.aggregateRating?.ratingValue)
    const rating = Number.isFinite(structuredRating) && structuredRating > 0
      ? structuredRating
      : Number(candidate.rating || 0)
    const totalTime = parseDurationMinutes(structured.totalTime)
      || parseDurationMinutes(structured.prepTime) + parseDurationMinutes(structured.cookTime)
      || candidate.total_time_minutes
    const ingredients = Array.isArray(structured.recipeIngredient)
      ? structured.recipeIngredient.map((item: unknown) => cleanString(item, 500)).filter(Boolean)
      : candidate.fallback_ingredients
    const title = cleanString(structured.name, 300) || candidate.title
    const recipeType = `${title} ${cleanString(structured.recipeCategory, 300)}`
    if (SALAD_PATTERN.test(recipeType) || !Number.isFinite(rating) || rating < 4 || !totalTime || ingredients.length === 0) {
      console.log(JSON.stringify({
        event: 'recipe_page_rejected',
        host: new URL(candidate.source_url).hostname,
        rating: Number.isFinite(rating) ? rating : null,
        total_time: totalTime,
        ingredients: ingredients.length,
      }))
      return null
    }
    return {
      external_key: await sha256(candidate.source_url),
      title,
      source_name: candidate.source_name,
      source_url: candidate.source_url,
      rating: Math.min(5, rating),
      reviews: Math.max(0, Number(structured.aggregateRating?.ratingCount || structured.aggregateRating?.reviewCount) || candidate.reviews),
      total_time_minutes: totalTime,
      image_url: structuredImage(structured.image) || candidate.image_url,
      servings: parseServings(structured.recipeYield),
      ingredient_lines: ingredients.slice(0, 40),
    }
  } catch (error) {
    console.log(JSON.stringify({
      event: 'recipe_page_failed',
      host: safeHostname(candidate.source_url),
      error: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
    }))
    return null
  }
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
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_PAGE_BYTES) throw new Error('Recipe page is too large')
  const html = decodeRecipePage(bytes, response.headers.get('content-type') || '')
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
    'Treat common Hebrew ingredient synonyms and harmless descriptions as equivalent: בטטה is תפוח אדמה מתוק; בשר טחון can match בקר טחון; singular and plural forms match; size words such as קטן, בינוני, and גדול do not change the food.',
    'A generic recipe ingredient may match a branded inventory product when the underlying food is the same.',
    'Convert the required recipe amount into the number of inventory packages represented by inventory.unit_qty.',
    'Example: 500 grams required and a matched 1 kilogram package means inventory_quantity_required=0.5.',
    'If inventory.unit_qty is יחידה, match a recipe count directly to inventory units.',
    'Parse Hebrew and symbolic fractions exactly: חצי or ½ is 0.5, רבע or ¼ is 0.25, and שלושת רבעי or ¾ is 0.75.',
    'When one produce unit is available and the recipe needs half a unit, inventory_quantity_required must be 0.5 and the ingredient is matched.',
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
  const inventoryQuantities = new Map(inventory.map((item) => [item.food_id, Number(item.quantity || 0)]))

  const normalizedRecipes = candidates.flatMap((candidate, index) => {
    const result = normalized.find((item: Record<string, unknown>) => Number(item.recipe_index) === index)
    if (!result || !Array.isArray(result.ingredients)) return []
    const normalizedTitle = safeText(result.title, safeText(candidate.title, 'שם המתכון אינו זמין', 300), 300)
    if (SALAD_PATTERN.test(normalizedTitle)) return []
    const ingredients = result.ingredients.slice(0, 40).map((item: Record<string, unknown>, ingredientIndex: number) => {
      const foodId = cleanString(item.food_id, 100)
      const requiredQuantity = Number(item.inventory_quantity_required)
      const originalLine = safeText(candidate.ingredient_lines?.[ingredientIndex], '', 500)
      return {
        name: safeText(item.name, originalLine || `מרכיב ${ingredientIndex + 1}`, 200),
        required_text: safeText(item.required_text, originalLine || 'הכמות לא צוינה במקור', 500),
        food_id: inventoryIds.has(foodId) && requiredQuantity > 0 ? foodId : '',
        inventory_quantity_required: inventoryIds.has(foodId) && requiredQuantity > 0 ? requiredQuantity : 0,
        optional: Boolean(item.optional),
      }
    })
    if (ingredients.length === 0) return []
    const requiredIngredients = ingredients.filter((ingredient) => !ingredient.optional)
    const availableIngredients = requiredIngredients.filter((ingredient) => (
      ingredient.food_id
      && ingredient.inventory_quantity_required > 0
      && Number(inventoryQuantities.get(ingredient.food_id) || 0) >= ingredient.inventory_quantity_required
    ))
    const inventoryMatchPercent = requiredIngredients.length > 0
      ? Math.round((availableIngredients.length / requiredIngredients.length) * 100)
      : 0
    return [{
      ...candidate,
      title: normalizedTitle,
      ingredient_lines: undefined,
      ingredients,
      inventory_match_percent: inventoryMatchPercent,
    }]
  })
  return normalizedRecipes.sort((a, b) => (
    b.inventory_match_percent - a.inventory_match_percent
    || b.rating - a.rating
    || b.reviews - a.reviews
  )).slice(0, MAX_RECIPES)
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

async function rpcResponse(name: string, body: Record<string, unknown>, privileged = false) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey) throw new Error('Supabase function environment is incomplete')
  const apiKey = privileged && serviceRoleKey ? serviceRoleKey : anonKey
  return await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
}

async function callRpc<T>(name: string, body: Record<string, unknown>, privileged = false): Promise<T> {
  const response = await rpcResponse(name, body, privileged)
  if (!response.ok) throw new Error(`Recipe database request failed (${response.status})`)
  return await response.json() as T
}

async function callOptionalRpc<T>(name: string, body: Record<string, unknown>, privileged = false): Promise<T | null> {
  const response = await rpcResponse(name, body, privileged)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Recipe database request failed (${response.status})`)
  return await response.json() as T
}

async function callRpcWithFallback<T>(primary: string, fallback: string, body: Record<string, unknown>): Promise<T> {
  const response = await rpcResponse(primary, body, true)
  if (response.ok) return await response.json() as T
  if (response.status !== 404) throw new Error(`Recipe database request failed (${response.status})`)
  return await callRpc<T>(fallback, body)
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

function genericFoodName(value: string, manufacturer = '') {
  let result = value
    .replace(/\b\d+(?:[.,]\d+)?\b/g, '')
    .replace(/[×x]\s*\d+/gi, '')
    .replace(/ק["״']?ג|קילו(?:גרם)?|גרם|מ["״']?ל|ליטר|יחידות?|אריזה|טרי|קפוא/gi, ' ')
  for (const word of manufacturer.split(/\s+/).filter((part) => part.length >= 3)) {
    result = result.replace(new RegExp(escapeRegExp(word), 'gi'), ' ')
  }
  return result.replace(/\s+/g, ' ').trim()
}

function inventorySearchTerms(inventory: InventoryItem[]) {
  return Array.from(new Set(inventory
    .filter((item) => item.name
      && !NON_FOOD_PATTERN.test(`${item.name} ${item.manufacturer || ''}`)
      && !SALAD_PATTERN.test(item.name))
    .sort((a, b) => recipeSearchPriority(a) - recipeSearchPriority(b))
    .map((item) => genericFoodName(item.name, item.manufacturer))
    .filter((term) => term.length >= 2)))
}

function buildRecipeSearchQuery(inventory: InventoryItem[]) {
  const mainIngredient = inventorySearchTerms(inventory)[0]
  return mainIngredient ? `מתכונים עם ${mainIngredient} -סלט` : 'מתכונים לארוחה ביתית -סלט'
}

async function inventoryRecipeSearchKey(inventory: InventoryItem[]) {
  const fingerprint = inventorySearchTerms(inventory).slice(0, 12).sort().join('|')
  return fingerprint ? `gemini-plan-v1:${await sha256(fingerprint)}` : ''
}

function uniqueDishNames(value: unknown) {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item) => {
    const dish = cleanString(item, 100).replace(/["“”]/g, '')
    const key = dish.toLocaleLowerCase('he')
    if (!dish || SALAD_PATTERN.test(dish) || seen.has(key)) return []
    seen.add(key)
    return [dish]
  }).slice(0, MAX_RECIPES)
}

function buildDishSearchQuery(dishes: string[]) {
  const alternatives = dishes.map((dish) => `"${dish}"`).join(' OR ')
  return `מתכון (${alternatives}) -סלט`
}

function rankCatalogCandidates(candidates: RecipeCandidate[], inventory: InventoryItem[]) {
  const terms = inventorySearchTerms(inventory).slice(0, 20).map((term) => term.toLocaleLowerCase('he'))
  return candidates
    .filter((candidate) => isUsableRecipeCandidate(candidate)
      && !SALAD_PATTERN.test(candidate.title))
    .map((candidate) => {
      const searchable = `${candidate.title} ${candidate.ingredient_lines.join(' ')}`.toLocaleLowerCase('he')
      const matchScore = terms.reduce((score, term) => score + (searchable.includes(term) ? 1 : 0), 0)
      return { candidate, matchScore }
    })
    .sort((left, right) => right.matchScore - left.matchScore
      || right.candidate.rating - left.candidate.rating
      || right.candidate.reviews - left.candidate.reviews)
    .map(({ candidate }) => candidate)
}

function uniqueRecipeCandidates(candidates: RecipeCandidate[]) {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = candidate.external_key || candidate.source_url
    if (!key || seen.has(key) || !isUsableRecipeCandidate(candidate) || SALAD_PATTERN.test(candidate.title)) return false
    seen.add(key)
    return true
  })
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function recipeSearchPriority(item: InventoryItem) {
  const value = `${item.category || ''} ${item.name || ''}`
  if (/בשר\s*(?:בקר\s*)?טחון|בקר\s*טחון|טחון\s*(?:בקר\s*)?בשר|ground\s+(?:beef|meat)|minced\s+(?:beef|meat)/i.test(value)) return -1
  if (/בשר|דגים|עוף|קטניות|דגנים|פסטה|אורז/i.test(value)) return 0
  if (/פירות|ירקות|ביצים|חלב|גבינ/i.test(value)) return 1
  if (/בישול|אפייה|שימורים/i.test(value)) return 2
  if (/חטיפים|ממתקים|משקאות/i.test(value)) return 5
  return 3
}

function validRecipeSourceUrl(value: string) {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && !unsafeHostname(url.hostname)
      && !/youtube\.com|youtu\.be|facebook\.com|instagram\.com|tiktok\.com/i.test(url.hostname)
      && !/\.pdf(?:$|\?)/i.test(url.pathname)
  } catch {
    return false
  }
}

function safeHostname(value: string) {
  try {
    return new URL(value).hostname
  } catch {
    return 'invalid'
  }
}

function unsafeHostname(hostname: string) {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host.endsWith('.local') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')
}

function decodeHtml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, digits) => decodeCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#(\d+);/g, (_match, digits) => decodeCodePoint(Number.parseInt(digits, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
}

function decodeCodePoint(value: number) {
  try {
    return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : ''
  } catch {
    return ''
  }
}

function decodeRecipePage(bytes: Uint8Array, contentType: string) {
  const declaredCharset = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]
  const labels = [...new Set([declaredCharset, 'utf-8', 'windows-1255', 'iso-8859-8'].filter(Boolean) as string[])]
  const decoded = labels.flatMap((label, index) => {
    try {
      const text = new TextDecoder(label, { fatal: false }).decode(bytes)
      return [{ text, score: brokenTextScore(text) + index / 100 }]
    } catch {
      return []
    }
  })
  decoded.sort((left, right) => left.score - right.score)
  return (decoded[0]?.text || new TextDecoder().decode(bytes)).slice(0, MAX_PAGE_BYTES)
}

function brokenTextScore(value: string) {
  const replacementCharacters = (value.match(/\uFFFD/g) || []).length
  const mojibakeSequences = (value.match(/[ÃÂ][\u0080-\u00ff]|ï¿½/g) || []).length
  const brokenHebrewSequences = (value.match(/×/g) || []).length
  const controlCharacters = (value.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g) || []).length
  return replacementCharacters * 1000 + mojibakeSequences * 50 + brokenHebrewSequences * 20 + controlCharacters * 10
}

function hasBrokenText(value: string) {
  return /\uFFFD|ï¿½|(?:\?\s*){3,}/.test(value)
}

function isUsableRecipeCandidate(candidate: RecipeCandidate) {
  return Boolean(candidate?.source_url)
    && Boolean(cleanString(candidate?.title, 300))
    && !hasBrokenText(candidate.title)
    && Array.isArray(candidate.ingredient_lines)
    && candidate.ingredient_lines.length > 0
    && candidate.ingredient_lines.every((line) => Boolean(cleanString(line, 500)) && !hasBrokenText(line))
}

function safeText(value: unknown, fallback: string, maxLength: number) {
  const text = cleanString(value, maxLength)
  return text && !hasBrokenText(text) ? text : cleanString(fallback, maxLength)
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
