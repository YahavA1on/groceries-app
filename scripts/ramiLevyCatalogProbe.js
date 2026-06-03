import { createClient } from '@supabase/supabase-js'

const DEFAULT_ENDPOINT = 'https://www.rami-levy.co.il/api/catalog'
const SOURCE_NAME = 'rami-levy'
const DEFAULT_STORE = '331'

function parseArgs(argv) {
  const options = {
    endpoint: DEFAULT_ENDPOINT,
    method: 'POST',
    branch: DEFAULT_STORE,
    category: '',
    query: 'חלב',
    limit: 40,
    upsert: false,
    body: '',
    token: process.env.RAMI_LEVY_TOKEN || '',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--upsert') options.upsert = true
    else if (arg === '--dry-run') options.upsert = false
    else if (arg === '--endpoint') options.endpoint = argv[++index]
    else if (arg === '--method') options.method = argv[++index]?.toUpperCase() || 'GET'
    else if (arg === '--branch') options.branch = argv[++index]
    else if (arg === '--category') options.category = argv[++index]
    else if (arg === '--query') options.query = argv[++index]
    else if (arg === '--limit') options.limit = Number(argv[++index] || 40)
    else if (arg === '--body') options.body = argv[++index]
    else if (arg === '--token') options.token = argv[++index]
  }

  return options
}

function buildUrl(options) {
  const url = new URL(options.endpoint)
  if (url.pathname.endsWith('/api/catalog') && !url.search) {
    return `${url.toString()}?`
  }

  if (options.method !== 'GET') return url.toString()

  if (options.branch) url.searchParams.set('store', options.branch)
  if (options.category) url.searchParams.set('category', options.category)
  if (options.query) url.searchParams.set('q', options.query)

  return url.toString()
}

function buildBody(options) {
  if (options.method === 'GET') return undefined
  if (options.body) return options.body

  return JSON.stringify({
    q: options.query || undefined,
    aggs: 1,
    store: options.branch || DEFAULT_STORE,
    category: options.category || undefined,
  })
}

async function fetchCatalog(options) {
  const body = buildBody(options)
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json;charset=UTF-8',
    'User-Agent': 'groceries-app-catalog-probe/1.0',
    locale: 'he',
    origin: 'https://www.rami-levy.co.il',
    referer: 'https://www.rami-levy.co.il/he',
  }

  if (options.token) headers.authorization = `Bearer ${options.token}`

  const response = await fetch(buildUrl(options), {
    method: options.method,
    headers,
    body,
  })

  const text = await response.text()
  if (!response.ok) {
    const authHint = options.token
      ? ''
      : ' Capture the catalog XHR request in the browser Network tab and pass --token or RAMI_LEVY_TOKEN if the endpoint requires an active session.'
    throw new Error(`Rami Levy request failed with ${response.status}: ${text.slice(0, 300)}${authHint}`)
  }

  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`Response was not JSON: ${error.message}`, { cause: error })
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
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value !== 'object') return null

  for (const key of nestedKeys) {
    if (value[key] !== undefined && value[key] !== null && value[key] !== '') return String(value[key])
  }

  return null
}

function normalizeImageUrl(value) {
  if (!value) return null
  const image = String(value)
  if (image.startsWith('http://') || image.startsWith('https://')) return image
  if (image.startsWith('//')) return `https:${image}`
  if (image.startsWith('/')) return `https://www.rami-levy.co.il${image}`
  return image
}

function asNumber(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object') {
    return asNumber(firstValue(value, ['price', 'value', 'amount']))
  }
  const parsed = Number(String(value).replace(/[^\d.]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function looksLikeProduct(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false

  const name = firstValue(record, [
    'name',
    'title',
    'itemName',
    'item_name',
    'productName',
    'product_name',
    'description',
  ])
  const price = firstValue(record, ['price', 'finalPrice', 'final_price', 'salePrice', 'itemPrice'])

  return Boolean(name && price !== null)
}

function collectProductRecords(payload) {
  const records = []
  const seen = new Set()

  function visit(value) {
    if (!value || typeof value !== 'object') return

    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }

    if (looksLikeProduct(value)) {
      const marker = JSON.stringify([
        firstValue(value, ['id', 'itemId', 'item_id', 'barcode', 'code']),
        firstValue(value, ['name', 'title', 'itemName', 'item_name', 'productName', 'product_name']),
      ])
      if (!seen.has(marker)) {
        seen.add(marker)
        records.push(value)
      }
    }

    for (const nested of Object.values(value)) visit(nested)
  }

  visit(payload)
  return records
}

function mapProduct(record) {
  const barcode = firstValue(record, ['barcode', 'barCode', 'code', 'itemCode', 'item_code'])
  const externalId = firstValue(record, ['id', 'itemId', 'item_id', 'productId', 'product_id', 'code']) || barcode
  const name = firstValue(record, [
    'name',
    'title',
    'itemName',
    'item_name',
    'productName',
    'product_name',
    'description',
  ])

  if (!externalId || !name) return null

  return {
    external_id: String(externalId),
    barcode: barcode ? String(barcode) : null,
    name: String(name).trim(),
    price: asNumber(firstValue(record, ['price', 'finalPrice', 'final_price', 'salePrice', 'itemPrice'])),
    image_url: normalizeImageUrl(
      firstValue(record, ['image', 'imageUrl', 'image_url', 'pic', 'picture', 'img']) ||
        firstValue(record.images, ['small', 'original', 'trim', 'transparent'])
    ),
    category: textValue(
      firstValue(record, ['category', 'categoryName', 'category_name', 'department', 'departmentName']),
      ['name', 'title']
    ),
    brand: textValue(
      firstValue(record, ['brand', 'brandName', 'brand_name', 'manufacturer', 'supplierName']) ||
        firstValue(record.gs, ['BrandName']),
      ['name', 'title']
    ),
    unit_qty:
      textValue(firstValue(record, ['unitQty', 'unit_qty', 'unit', 'size', 'weight', 'measure']), ['text', 'name']) ||
      textValue(firstValue(record.gs, ['Net_Content']), ['text']),
    source: SOURCE_NAME,
    source_payload: record,
    last_updated: new Date().toISOString(),
  }
}

async function upsertProducts(products) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to upsert products.')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  const { error } = await supabase.from('products').upsert(products, {
    onConflict: 'external_id',
  })

  if (error) {
    if (error.message?.includes("Could not find the table 'public.products'")) {
      throw new Error(
        "Supabase is missing public.products. Run supabase/schema.sql in the Supabase SQL editor for the project in VITE_SUPABASE_URL, then run: notify pgrst, 'reload schema';",
        { cause: error }
      )
    }
    throw error
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const payload = await fetchCatalog(options)
  const mapped = collectProductRecords(payload)
    .map(mapProduct)
    .filter(Boolean)
    .slice(0, options.limit)

  if (mapped.length === 0) {
    console.error('No product-like records were found. Inspect the Network tab and pass --endpoint/--method/--body.')
    process.exitCode = 1
    return
  }

  if (options.upsert) {
    await upsertProducts(mapped)
    console.log(`Upserted ${mapped.length} products into public.products.`)
    return
  }

  console.log(JSON.stringify(mapped, null, 2))
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
