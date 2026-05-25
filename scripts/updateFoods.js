import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

const foods = [
  { name: 'בשר טחון', query: 'ground beef' },
  { name: 'טורטיות', query: 'tortillas' },
  { name: 'פסטה קונכיות', query: 'pasta shells' },
  { name: 'חזה עוף', query: 'chicken breast' },
  { name: 'פירורי לחם', query: 'breadcrumbs' },
  { name: 'ביצים', query: 'eggs' },
  { name: 'תפוחי אדמה', query: 'potatoes' },
  { name: 'פתיתים', query: 'cereal flakes' },
  { name: 'טונה בקופסה', query: 'canned tuna' },
  { name: 'רוטב עגבניות', query: 'tomato sauce' },
  { name: 'עגבניות מרוסקות', query: 'crushed tomatoes' },
  { name: 'רסק עגבניות', query: 'tomato paste' },
  { name: 'פסטו', query: 'pesto' },
  { name: 'שמנת לבישול', query: 'cooking cream' },
  { name: 'חלב', query: 'milk' },
  { name: 'חמאה', query: 'butter' },
  { name: 'גבינה צהובה', query: 'yellow cheese' },
  { name: 'גבינה מגורדת', query: 'grated cheese' },
  { name: 'אבקת חלבון', query: 'protein powder' },
  { name: 'מעדן חלבון', query: 'protein snack' },
  { name: 'פיצה מעדנות קפואה', query: 'frozen pizza' },
  { name: 'בצל', query: 'onion' },
  { name: 'שום', query: 'garlic' },
]

async function fetchImage(query) {
  try {
    // Using Unsplash API for free high-quality images
    const response = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&client_id=1VKVHXczgULX1pxJd6qF6e0a_jDe3f7bTVW5xJcE_Bw`
    )
    if (!response.ok) throw new Error('Unsplash API error')
    const data = await response.json()
    if (data.results && data.results[0]) {
      return data.results[0].urls.regular
    }
    return null
  } catch (err) {
    console.log(`Failed to fetch image for ${query}: ${err.message}`)
    return null
  }
}

async function updateFoods() {
  console.log('🗑️ Deleting existing foods...')
  
  // Delete existing foods
  const { error: deleteError } = await supabase
    .from('foods')
    .delete()
    .neq('id', '') // Delete all

  if (deleteError) {
    console.error('Error deleting foods:', deleteError)
    return
  }

  console.log('✅ Foods deleted')
  console.log('📸 Fetching images and inserting new foods...')

  const newFoods = []

  for (const food of foods) {
    console.log(`  Processing: ${food.name}...`)
    const imageUrl = await fetchImage(food.query)
    
    newFoods.push({
      name: food.name,
      picture_url: imageUrl,
      manufacturer: null,
      price: 0,
      unit_qty: null,
    })

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  console.log('📤 Uploading to database...')
  
  const { data, error } = await supabase
    .from('foods')
    .insert(newFoods)

  if (error) {
    console.error('Error inserting foods:', error)
    return
  }

  console.log(`✅ Successfully added ${newFoods.length} foods!`)
  console.log('\n📋 Foods added:')
  newFoods.forEach((food, i) => {
    console.log(`  ${i + 1}. ${food.name} ${food.picture_url ? '✓' : '✗'}`)
  })
}

updateFoods().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
