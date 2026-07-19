import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { getFoodCategory } from '../src/lib/foodFilters.js'
import { isNonFoodProduct } from '../src/lib/productRules.js'

const DEFAULT_MANUFACTURER = 'רמי לוי'
const BATCH_SIZE = 35
const MIN_CONFIDENCE = 0.7
const PRODUCT_OVERRIDES = new Map([
  ['seed_043', { name: 'בירה לא מסוננת', manufacturer: 'גולדסטאר', unit_qty: '6 יחידות' }],
  ['food_1779892775457_j33vi2k9c', { name: 'יוגורט גו וניל', manufacturer: 'גו', unit_qty: '200 גרם' }],
  ['rami_7290000056906', { name: 'יוגורט יופלה לבן טבעי 1.5%', manufacturer: 'יופלה', unit_qty: '1.2 ק״ג' }],
  ['rami_7290013144393', { name: 'תמצית וניל', manufacturer: 'מימונס', unit_qty: '50 מ״ל' }],
  ['rami_7290000453248', { name: 'מיני פנקייק מוכן', manufacturer: 'שמרית', unit_qty: '300 גרם' }],
  ['food_1779895171889_454vvn5h0', { manufacturer: 'מימונס' }],
  ['food_1779894389827_nudg7mgjq', { manufacturer: 'מימונס' }],
  ['food_1779894367959_zan9uglgb', { manufacturer: 'מימונס' }],
  ['food_1779895064370_ol02tzhx6', { manufacturer: 'יד מרדכי' }],
  ['food_1779894063777_r58yjk0ie', { manufacturer: 'מוטי' }],
  ['seed_040', { manufacturer: 'קוקה-קולה' }],
  ['food_1779893379120_hdtjddo6g', { manufacturer: 'שנדי', unit_qty: '6 יחידות' }],
  ['rami_7290019635468', { unit_qty: '250 גרם' }],
  ['rami_4000417626011', { name: 'שוקולד מריר 70%', manufacturer: 'ריטר ספורט', unit_qty: '100 גרם' }],
  ['rami_7290004125721', { name: 'שמנת לבישול 15%', manufacturer: 'השף הלבן', unit_qty: '250 מ״ל' }],
  ['rami_111', { unit_qty: 'ק״ג' }],
])
const VARIABLE_WEIGHT_PRODUCE_PATTERN = /בננה|בצל|עגבני|מלפפון|תפוח\s*(?:אדמה|אדום|ירוק|עץ)|מנגו|אגס|ענבים|אבטיח|מלון|אפרסק|נקטרינה|שזיף|קיווי|קלמנטינה|אשכולית|פומלה|אננס|דובדבן|משמש|רימון/i

function loadLocalEnv() {
  const file = path.resolve('.env.local')
  if (!fs.existsSync(file)) return {}
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), line.slice(separator + 1)]
      }),
  )
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function chunks(values, size) {
  const result = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

function compactEvidence(food) {
  const values = [food.name, food.manufacturer, food.unit_qty]
  const usefulKeys = /name|title|description|brand|manufacturer|supplier|unit|weight|measure|content/i

  function visit(value, key = '', depth = 0) {
    if (depth > 4 || value === null || value === undefined) return
    if (typeof value === 'string' || typeof value === 'number') {
      if (usefulKeys.test(key)) values.push(String(value))
      return
    }
    if (Array.isArray(value)) {
      value.slice(0, 12).forEach((item) => visit(item, key, depth + 1))
      return
    }
    if (typeof value === 'object') {
      Object.entries(value).forEach(([nestedKey, nestedValue]) => visit(nestedValue, nestedKey, depth + 1))
    }
  }

  visit(food.raw)
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value).replace(/\s+/g, ' ').trim())))
    .join(' | ')
    .slice(0, 300)
}

function comparableWords(value) {
  return String(value || '')
    .toLocaleLowerCase('he')
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 2)
}

function similarCandidates(food, allFoods) {
  const sourceWords = new Set(comparableWords(`${food.name} ${food.manufacturer || ''}`))
  if (sourceWords.size === 0) return []

  return allFoods
    .filter((candidate) => candidate.id !== food.id)
    .map((candidate) => {
      const candidateWords = new Set(comparableWords(`${candidate.name} ${candidate.manufacturer || ''}`))
      const overlap = Array.from(sourceWords).filter((word) => candidateWords.has(word)).length
      const score = overlap / Math.max(1, Math.min(sourceWords.size, candidateWords.size))
      return { candidate, score }
    })
    .filter(({ score }) => score >= 0.34)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map(({ candidate }) => ({
      id: String(candidate.id),
      name: candidate.name,
      manufacturer: candidate.manufacturer || '',
      unit_qty: candidate.unit_qty || '',
    }))
}

async function normalizeBatch(functionUrl, apiKey, foods, allFoods) {
  const items = foods.map((food, index) => ({
    index,
    raw_name: compactEvidence(food),
    current_name: food.name,
    manufacturer: food.manufacturer || '',
    unit_qty: food.unit_qty || '',
    candidates: similarCandidates(food, allFoods),
  }))
  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Origin: 'https://yahava1on.github.io',
      apikey: apiKey,
    },
    body: JSON.stringify({ action: 'normalize', items }),
    signal: AbortSignal.timeout(45_000),
  })
  if (!response.ok) throw new Error(`Gemini normalization failed (${response.status}): ${(await response.text()).slice(0, 300)}`)
  const payload = await response.json()
  if (!Array.isArray(payload.items) || payload.items.length !== foods.length) throw new Error('Gemini returned an incomplete catalog batch.')
  return payload.items
}

function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function normalizeUnit(value) {
  const unit = cleanText(value)
    .replace(/גר(?:'|׳)?(?=\s|$)/g, 'גרם')
    .replace(/ק["״']?ג/g, 'ק״ג')
    .replace(/מ["״']?ל/g, 'מ״ל')
  return unit || 'יחידה'
}

function chooseUnit(food, aiItem) {
  const current = normalizeUnit(food.unit_qty)
  const proposed = normalizeUnit(aiItem.unit_qty)
  if (/^(?:ק״ג|גרם|ליטר|מ״ל|יחידות?)$/.test(current) && proposed === 'יחידה') return current
  return proposed
}

function cleanCatalogName(value, manufacturer, unitQty) {
  let name = cleanText(value)
  if (manufacturer && manufacturer !== DEFAULT_MANUFACTURER) {
    name = name.replace(new RegExp(escapeRegex(manufacturer), 'giu'), ' ')
  }
  name = name
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:גרם|גר|ג|ק["״']?ג|מ["״']?ל|ליטר|יחידות?|יח[׳'])\b/giu, ' ')
    .replace(/\b\d+\s*[xX×]\s*\d+\b/gu, ' ')
  if (unitQty) name = name.replace(new RegExp(escapeRegex(unitQty), 'giu'), ' ')
  return name.replace(/\s+/g, ' ').trim() || cleanText(value)
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildProposal(food, aiItem) {
  if (isNonFoodProduct(food)) {
    const before = {
      name: cleanText(food.name),
      manufacturer: cleanText(food.manufacturer),
      unit_qty: cleanText(food.unit_qty),
    }
    return { id: food.id, external_id: food.external_id, confidence: 1, before, after: before, fields: [], review_required: false }
  }

  const confident = Number(aiItem.confidence) >= MIN_CONFIDENCE
  const unitQty = confident ? chooseUnit(food, aiItem) : normalizeUnit(food.unit_qty)
  const manufacturer = cleanText(confident ? aiItem.manufacturer : food.manufacturer) || cleanText(food.manufacturer) || DEFAULT_MANUFACTURER
  const name = confident ? cleanCatalogName(aiItem.name, manufacturer, unitQty) : cleanText(food.name)
  const after = { name, manufacturer, unit_qty: unitQty }
  const isProduce = getFoodCategory(food) === 'פירות וירקות'
  if (isProduce) after.manufacturer = DEFAULT_MANUFACTURER
  if (isProduce && VARIABLE_WEIGHT_PRODUCE_PATTERN.test(food.name)) after.unit_qty = 'ק״ג'
  Object.assign(after, PRODUCT_OVERRIDES.get(food.external_id) || {})
  const before = {
    name: cleanText(food.name),
    manufacturer: cleanText(food.manufacturer),
    unit_qty: cleanText(food.unit_qty),
  }
  const fields = Object.keys(after).filter((field) => after[field] !== before[field])
  const hasVerifiedOverride = PRODUCT_OVERRIDES.has(food.external_id) || isProduce
  return {
    id: food.id,
    external_id: food.external_id,
    confidence: Number(aiItem.confidence) || 0,
    before,
    after,
    fields,
    review_required: !hasVerifiedOverride && !confident && (!food.manufacturer || !food.unit_qty || !/[\u0590-\u05ff]/.test(`${food.name} ${food.manufacturer || ''}`)),
  }
}

async function main() {
  const env = { ...loadLocalEnv(), ...process.env }
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL
  const apiKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !apiKey) throw new Error('Missing Supabase URL or publishable key.')

  const supabase = createClient(supabaseUrl, apiKey, { auth: { persistSession: false } })
  const { data: foods, error } = await supabase.from('foods').select('*').order('name')
  if (error) throw error

  const outputDirectory = path.resolve('backups')
  fs.mkdirSync(outputDirectory, { recursive: true })
  const runId = timestamp()
  const functionUrl = `${supabaseUrl}/functions/v1/receipt-proxy`

  const backupPath = path.join(outputDirectory, `foods-before-${runId}.json.local`)
  const reportPath = path.join(outputDirectory, `foods-cleanup-${runId}.json.local`)
  fs.writeFileSync(backupPath, `${JSON.stringify(foods, null, 2)}\n`)

  const normalized = []
  for (const batch of chunks(foods, BATCH_SIZE)) {
    normalized.push(...await normalizeBatch(functionUrl, apiKey, batch, foods))
  }

  const proposals = foods.map((food, index) => buildProposal(food, normalized[index]))
  const changes = proposals.filter((proposal) => proposal.fields.length > 0)
  const report = {
    created_at: new Date().toISOString(),
    product_count: foods.length,
    change_count: changes.length,
    review_count: proposals.filter((proposal) => proposal.review_required).length,
    backup_path: backupPath,
    changes,
  }
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)

  console.log(JSON.stringify({
    products: foods.length,
    proposed_changes: changes.length,
    needs_review: proposals.filter((proposal) => proposal.review_required).length,
    backup: backupPath,
    report: reportPath,
  }, null, 2))
  console.table(changes.map((change) => ({
    name_before: change.before.name,
    name_after: change.after.name,
    manufacturer: change.after.manufacturer,
    unit_qty: change.after.unit_qty,
    confidence: change.confidence,
  })))
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
