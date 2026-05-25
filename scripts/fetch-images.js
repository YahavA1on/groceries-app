import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const OFF_URL = 'https://world.openfoodfacts.org/cgi/search.pl'

async function searchOFF(query, biasIsrael = true) {
  const params = new URLSearchParams({
    search_terms: query,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '10',
    fields: 'product_name,product_name_he,image_url,image_front_url,brands,countries',
  })
  if (biasIsrael) params.set('countries_tags', 'israel')

  const res = await fetch(`${OFF_URL}?${params}`, {
    headers: { 'User-Agent': 'GroceriesApp/1.0 (personal use)' },
  })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  const data = await res.json()
  for (const p of data.products || []) {
    const url = p.image_front_url || p.image_url
    if (url) return { url, name: p.product_name_he || p.product_name, brands: p.brands }
  }
  return null
}

async function searchWithRetry(query, biasIsrael, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await searchOFF(query, biasIsrael)
    } catch (e) {
      if ((e.status === 503 || e.status === 429) && i < attempts - 1) {
        const wait = 2000 * (i + 1)
        process.stdout.write(`(${e.status}, waiting ${wait/1000}s) `)
        await new Promise(r => setTimeout(r, wait))
      } else {
        throw e
      }
    }
  }
}

async function findImage(food) {
  const base = food.manufacturer ? `${food.name} ${food.manufacturer}` : food.name
  let hit = await searchWithRetry(base, true)
  if (hit) return hit
  if (food.manufacturer) {
    hit = await searchWithRetry(food.name, true)
    if (hit) return hit
  }
  return await searchWithRetry(food.name, false)
}

async function main() {
  const { data: foods, error } = await supabase
    .from('foods')
    .select('id, name, manufacturer')
    .is('picture_url', null)
    .order('name')

  if (error) { console.error(error); process.exit(1) }
  console.log(`${foods.length} foods still need images\n`)

  let updated = 0, failed = 0
  for (const food of foods) {
    const label = food.manufacturer ? `${food.name} (${food.manufacturer})` : food.name
    process.stdout.write(`${label.padEnd(45)} → `)
    try {
      const hit = await findImage(food)
      if (!hit) { console.log('(no match)'); failed++; continue }
      const { error: upErr } = await supabase
        .from('foods').update({ picture_url: hit.url }).eq('id', food.id)
      if (upErr) throw upErr
      console.log(`✓ "${hit.name || '(no name)'}"`)
      updated++
    } catch (e) {
      console.log(`ERROR ${e.message}`)
      failed++
    }
    await new Promise(r => setTimeout(r, 1200))   // ~1 req/sec
  }
  console.log(`\nUpdated: ${updated}, Failed: ${failed}`)
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1) })