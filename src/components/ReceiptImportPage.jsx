import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TopNotice from './TopNotice'
import { addReceiptInventoryQuantities, DEFAULT_MANUFACTURER } from '../lib/foodData'
import { buildFoodInsert, fetchReceiptText, parseReceiptItems } from '../lib/receiptImport'
import { fetchCatalogFromServer, normalizeReceiptItemsWithAi } from '../lib/receiptApi'
import { getFoodCategory } from '../lib/foodFilters'
import { supabase } from '../lib/supabase'
import { isNonFoodProduct } from '../lib/productRules'
import { userErrorMessage } from '../lib/userErrors'

export default function ReceiptImportPage({ session }) {
  const [receiptUrl, setReceiptUrl] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const canImport = session.member_role === 'manager' || session.is_admin
  const scanReceiptUrl = useCallback(async (value) => {
    setLoading(true)
    setError('')
    setSuccess('')
    setItems([])

    try {
      const normalizedUrl = validateReceiptUrl(value)
      const raw = await fetchReceiptText(normalizedUrl)
      const parsed = parseReceiptItems(raw)
      if (parsed.length === 0) {
        throw new Error('לא נמצאו מוצרים בקבלה.')
      }

      const enrichedItems = await enrichReceiptItems(parsed)
      if (enrichedItems.length === 0) throw new Error('לא נמצאו מוצרי מזון להוספה בקבלה.')
      setItems(enrichedItems)
    } catch (scanError) {
      setError(userErrorMessage(scanError, 'לא הצלחתי לסרוק את הקבלה. נסו שוב.'))
    } finally {
      setLoading(false)
    }
  }, [])

  function scanReceipt(event) {
    event.preventDefault()
    if (!receiptUrl.trim()) return
    void scanReceiptUrl(receiptUrl)
  }

  const handleQrDetected = useCallback((url) => {
    setReceiptUrl(url)
    setQrOpen(false)
    void scanReceiptUrl(url)
  }, [scanReceiptUrl])
  const closeQrScanner = useCallback(() => setQrOpen(false), [])

  async function importReceipt() {
    if (!canImport || items.length === 0) return

    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const itemFoods = await ensureFoods(items, session)
      const { newInventoryCount, removedRequestCount } = await addReceiptInventoryQuantities(session, itemFoods)
      const requestMessage = removedRequestCount > 0 ? ` ${removedRequestCount} בקשות תואמות הוסרו מהרשימה.` : ''
      setSuccess(`נוספו ${newInventoryCount} מוצרים חדשים למלאי הבית.${requestMessage}`)
      setItems([])
      setReceiptUrl('')
    } catch (saveError) {
      setError(userErrorMessage(saveError, 'לא הצלחתי להוסיף את המוצרים למלאי. נסו שוב.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-4">
      <TopNotice
        notice={error ? { tone: 'error', text: error } : success ? { tone: 'success', text: success } : null}
        onDismiss={() => {
          setError('')
          setSuccess('')
        }}
      />

      <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
        <h2 className="text-2xl font-black">סריקת קבלה</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          הדביקו קישור לקבלה מרמי לוי, בדקו את המוצרים שזוהו, ואז הוסיפו אותם למלאי הבית.
        </p>
      </div>

      <form className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900" onSubmit={scanReceipt}>
        <button
          className="mb-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 font-black text-slate-950 disabled:opacity-60"
          disabled={loading}
          onClick={() => {
            setError('')
            setSuccess('')
            setQrOpen(true)
          }}
          type="button"
        >
          <QrIcon />
          סריקת QR מהקבלה
        </button>

        <div className="mb-4 flex items-center gap-3 text-xs font-black text-slate-400">
          <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          <span>או הדבקת קישור</span>
          <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
        </div>

        <label className="text-sm font-black text-slate-600 dark:text-slate-300" htmlFor="receipt-url">
          קישור קבלה
        </label>
        <input
          className="mt-2 h-12 w-full rounded-xl border border-rose-200 bg-white px-3 text-base outline-none focus:border-rose-600 focus:ring-4 focus:ring-rose-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-rose-900/40"
          dir="ltr"
          id="receipt-url"
          onChange={(event) => setReceiptUrl(event.target.value)}
          placeholder="https://digi.rami-levy.co.il/..."
          type="url"
          value={receiptUrl}
        />

        <button
          className="mt-3 h-12 w-full rounded-xl bg-rose-600 px-4 font-black text-white disabled:opacity-60 dark:bg-cyan-400 dark:text-slate-950"
          disabled={loading || !receiptUrl.trim()}
          type="submit"
        >
          {loading ? 'סורק...' : 'סריקת קבלה'}
        </button>
      </form>

      {qrOpen ? <ReceiptQrScanner onClose={closeQrScanner} onDetected={handleQrDetected} /> : null}

      {items.length > 0 ? (
        <div className="sticky top-[73px] z-20 space-y-3 rounded-2xl border border-rose-100 bg-orange-50/95 p-2 shadow-xl backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
          <div className="flex items-center justify-between gap-3 px-1">
            <div>
              <h3 className="text-sm font-black uppercase tracking-wide text-rose-700 dark:text-cyan-300">פריטים שזוהו</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">{items.length} מוצרים ייחודיים</p>
            </div>
            <button
              className="rounded-xl bg-cyan-500 px-4 py-3 font-black text-slate-950 disabled:opacity-60"
              disabled={saving}
              onClick={importReceipt}
              type="button"
            >
              {saving ? 'מוסיף...' : 'הוספה למלאי'}
            </button>
          </div>

          <div className="max-h-[55dvh] space-y-2 overflow-auto pe-1">
            {items.map((item) => (
              <ReceiptItem item={item} key={`${item.external_id}-${item.name}`} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function validateReceiptUrl(value) {
  try {
    const url = new URL(String(value).trim())
    if (url.protocol !== 'https:' || url.hostname !== 'digi.rami-levy.co.il') {
      throw new Error('יש להדביק קישור קבלה תקין של רמי לוי.')
    }
    return url.toString()
  } catch {
    throw new Error('יש להדביק קישור קבלה תקין של רמי לוי.')
  }
}

function ReceiptQrScanner({ onClose, onDetected }) {
  const videoRef = useRef(null)
  const [cameraError, setCameraError] = useState('')
  const [starting, setStarting] = useState(true)

  useEffect(() => {
    let cancelled = false
    let controls = null
    const videoElement = videoRef.current

    async function startCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera unavailable')
        const { BrowserQRCodeReader } = await import('@zxing/browser')
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 200 })
        controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: 'environment' } } },
          videoElement,
          (result, _error, scannerControls) => {
            if (!result || cancelled) return
            try {
              const url = validateReceiptUrl(result.getText())
              scannerControls.stop()
              onDetected(url)
            } catch {
              setCameraError('ה-QR שנסרק אינו קישור לקבלה של רמי לוי. נסו שוב.')
            }
          },
        )
        if (cancelled) controls.stop()
      } catch (cameraStartError) {
        if (cancelled) return
        const denied = cameraStartError?.name === 'NotAllowedError' || cameraStartError?.name === 'PermissionDeniedError'
        setCameraError(denied ? 'יש לאשר גישה למצלמה כדי לסרוק את הקבלה.' : 'לא ניתן לפתוח את המצלמה. אפשר להדביק את הקישור ידנית.')
      } finally {
        if (!cancelled) setStarting(false)
      }
    }

    void startCamera()
    return () => {
      cancelled = true
      controls?.stop()
      const stream = videoElement?.srcObject
      if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop())
    }
  }, [onDetected])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4" role="dialog" aria-modal="true" aria-label="סריקת קוד QR">
      <div className="w-full max-w-md rounded-3xl bg-white p-4 shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-xl font-black">סריקת QR</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">כוונו את המצלמה לקוד שעל הקבלה.</p>
          </div>
          <button className="rounded-xl bg-slate-100 px-4 py-2 font-black dark:bg-slate-800" onClick={onClose} type="button">סגירה</button>
        </div>

        <div className="relative mt-4 aspect-square overflow-hidden rounded-2xl bg-black">
          <video className="h-full w-full object-cover" muted playsInline ref={videoRef} />
          <div className="pointer-events-none absolute inset-[12%] rounded-2xl border-4 border-cyan-400 shadow-[0_0_0_999px_rgba(0,0,0,0.2)]" />
          {starting ? <div className="absolute inset-0 flex items-center justify-center bg-black/60 font-black text-white">פותח מצלמה...</div> : null}
        </div>

        {cameraError ? <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-black text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{cameraError}</p> : null}
        <p className="mt-3 text-center text-xs text-slate-500 dark:text-slate-400">הצילום נשאר במכשיר ואינו נשלח לשרת.</p>
      </div>
    </div>
  )
}

function QrIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M8 8h2v2H8zM14 8h2v2h-2zM8 14h2v2H8zM14 14h2v2h-2z" />
    </svg>
  )
}

function ReceiptItem({ item }) {
  const [imageIndex, setImageIndex] = useState(0)
  const imageCandidates = useMemo(() => receiptImageCandidates(item), [item])
  const imageUrl = imageCandidates[imageIndex]

  return (
    <article className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm dark:bg-slate-900">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-cyan-100 dark:bg-slate-800">
        {imageUrl ? (
          <img
            alt=""
            className="h-full w-full object-contain"
            onError={() => setImageIndex((index) => index + 1)}
            src={imageUrl}
          />
        ) : (
          <span className="font-black text-rose-500">{item.name.slice(0, 1)}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h4 className="line-clamp-2 font-black leading-tight">{item.name}</h4>
        <p className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">{item.manufacturer || DEFAULT_MANUFACTURER}</p>
        <p className="mt-1 text-sm font-black text-rose-700 dark:text-cyan-300">{item.unit_qty || 'יחידה'}</p>
      </div>
      <span className="rounded-xl bg-cyan-100 px-3 py-2 text-sm font-black text-cyan-950 dark:bg-cyan-400 dark:text-slate-950">x{item.quantity}</span>
    </article>
  )
}

async function ensureFoods(items, session) {
  const externalIds = items.map((item) => item.external_id).filter(Boolean)
  const names = items.map((item) => item.name)
  const matchedFoodIds = unique(items.map((item) => item.matched_food_id).filter(Boolean))

  const [byIdResult, byExternalResult, byNameResult] = await Promise.all([
    matchedFoodIds.length > 0
      ? supabase.from('foods').select('id, external_id, name, manufacturer, unit_qty, picture_url').in('id', matchedFoodIds)
      : Promise.resolve({ data: [], error: null }),
    externalIds.length > 0
      ? supabase.from('foods').select('id, external_id, name, manufacturer, unit_qty, picture_url').in('external_id', externalIds)
      : Promise.resolve({ data: [], error: null }),
    names.length > 0
      ? supabase.from('foods').select('id, external_id, name, manufacturer, unit_qty, picture_url').in('name', names)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (byIdResult.error) throw byIdResult.error
  if (byExternalResult.error) throw byExternalResult.error
  if (byNameResult.error) throw byNameResult.error

  const foodByKey = new Map()
  for (const food of [...(byIdResult.data || []), ...(byExternalResult.data || []), ...(byNameResult.data || [])]) {
    foodByKey.set(`id:${food.id}`, food)
    if (food.external_id) foodByKey.set(food.external_id, food)
    foodByKey.set(food.name, food)
  }

  const missingItems = items.filter((item) => !findFoodForItem(foodByKey, item))

  if (missingItems.length > 0) {
    for (const item of missingItems) {
      const insert = buildFoodInsert(item)
      const { data: food, error } = await supabase.rpc('add_receipt_catalog_food', {
        p_session_token: session.token,
        p_external_id: insert.external_id || item.external_id || item.barcode || null,
        p_name: insert.name || item.name,
        p_manufacturer: insert.manufacturer || item.manufacturer || DEFAULT_MANUFACTURER,
        p_category: getFoodCategory({ ...item, ...insert }),
        p_unit_qty: insert.unit_qty || item.unit_qty || 'יחידה',
        p_picture_url: insert.picture_url || item.picture_url || null,
      })
      if (error) throw error
      foodByKey.set(`id:${food.id}`, food)
      if (food.external_id) foodByKey.set(food.external_id, food)
      foodByKey.set(food.name, food)
    }
  }

  return items.map((item) => ({
    item,
    food: findFoodForItem(foodByKey, item),
  }))
}

function findFoodForItem(foodByKey, item) {
  return (
    (item.matched_food_id ? foodByKey.get(`id:${item.matched_food_id}`) : null) ||
    foodByKey.get(item.external_id) ||
    foodByKey.get(item.name)
  )
}

async function enrichReceiptItems(items) {
  const filteredItems = items.filter((item) => !isWaterProduct(item))
  const { foodByKey, foods } = await loadMatchingFoods()
  const catalogByKey = await loadCatalogMatches(filteredItems, foodByKey)

  const enrichedItems = filteredItems.map((item) => {
    const matchedFood = foodByKey.get(item.external_id) || foodByKey.get(item.barcode) || foodByKey.get(item.name)
    const matchedCatalog = catalogByKey.get(item.external_id) || catalogByKey.get(item.barcode) || catalogByKey.get(item.name)
    const withSavedFood = matchedFood
      ? { ...mergeReceiptItemWithFood(item, matchedFood), matched_food_id: matchedFood.id }
      : normalizeReceiptFallback(item)
    const enriched = matchedCatalog ? mergeReceiptItemWithFood(withSavedFood, matchedCatalog) : withSavedFood
    return {
      ...enriched,
      match_candidates: rankFoodCandidates(item, foods),
    }
  })

  const normalizedItems = await applyAiNormalization(enrichedItems)
  return mergeDuplicateReceiptItems(
    normalizedItems
      .filter((item) => !isNonFoodProduct(item) && !isWaterProduct(item))
      .map(normalizeReceiptPresentation)
      .map(withReliableReceiptImage)
  )
}

async function loadMatchingFoods() {
  const { data, error } = await supabase
    .from('foods')
    .select('id, external_id, name, manufacturer, unit_qty, picture_url')
    .limit(1000)

  if (error) throw error

  const foodByKey = new Map()
  const foods = data || []
  for (const food of foods) {
    if (food.external_id) foodByKey.set(food.external_id, food)
    foodByKey.set(food.name, food)
  }
  return { foodByKey, foods }
}

function rankFoodCandidates(item, foods) {
  const itemWords = productMatchWords([item.name, item.manufacturer, item.unit_qty].filter(Boolean).join(' '))
  const externalIds = new Set([item.external_id, item.barcode].filter(Boolean).map(String))

  return foods
    .map((food) => {
      const foodWords = productMatchWords([food.name, food.manufacturer, food.unit_qty].filter(Boolean).join(' '))
      const externalMatch = food.external_id && externalIds.has(String(food.external_id))
      const score = (externalMatch ? 10 : 0) + fuzzyProductSimilarity(itemWords, foodWords)
      return { food, score }
    })
    .filter(({ score }) => score >= 0.42)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ food }) => food)
}

function fuzzyProductSimilarity(leftWords, rightWords) {
  if (leftWords.length === 0 || rightWords.length === 0) return 0
  const leftScore = averageBestWordSimilarity(leftWords, rightWords)
  const rightScore = averageBestWordSimilarity(rightWords, leftWords)
  return leftScore * 0.7 + rightScore * 0.3
}

function averageBestWordSimilarity(words, candidates) {
  return words.reduce((sum, word) => {
    const best = candidates.reduce((score, candidate) => Math.max(score, wordSimilarity(word, candidate)), 0)
    return sum + best
  }, 0) / words.length
}

function wordSimilarity(left, right) {
  if (left === right) return 1
  const longest = Math.max(left.length, right.length)
  if (longest === 0) return 1
  return 1 - levenshteinDistance(left, right) / longest
}

function levenshteinDistance(left, right) {
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

function productMatchWords(value) {
  return String(value)
    .toLocaleLowerCase('he')
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 2)
}

function mergeReceiptItemWithFood(item, food) {
  const parsed = splitReceiptName(food.name || item.name)
  const manufacturer = validManufacturer(food.manufacturer) || validManufacturer(item.manufacturer) || parsed.manufacturer || null
  const unitQty = mergeUnitQty(food.unit_qty || item.unit_qty, parsed.unitQty)

  return {
    ...item,
    name: cleanDisplayName(parsed.name, manufacturer, unitQty),
    manufacturer,
    unit_qty: unitQty,
    picture_url: food.picture_url || item.picture_url,
  }
}

async function loadCatalogMatches(items, existingFoodByKey) {
  const missingItems = items.filter(
    (item) => {
      const food = existingFoodByKey.get(item.external_id) || existingFoodByKey.get(item.barcode) || existingFoodByKey.get(item.name)
      return !food || !food.picture_url || !validManufacturer(food.manufacturer) || !food.unit_qty
    }
  )
  const catalogByKey = new Map()

  await Promise.all(missingItems.map(async (item) => {
    const query = item.barcode || item.external_id || item.name
    if (!query) return

    try {
      const payload = await fetchCatalogFromServer(query)
      const mappedRecords = collectCatalogRecords(payload)
        .map(mapCatalogRecord)
        .filter(Boolean)
      const match =
        mappedRecords.find((record) => record.external_id === item.external_id || record.external_id === item.barcode || record.name === item.name) ||
        (mappedRecords.length === 1 ? mappedRecords[0] : null)

      if (match) {
        catalogByKey.set(item.external_id, match)
        if (item.barcode) catalogByKey.set(item.barcode, match)
        catalogByKey.set(item.name, match)
      }
    } catch {
      // Catalog enrichment is best-effort; receipt import still works without it.
    }
  }))

  return catalogByKey
}

function collectCatalogRecords(payload) {
  const records = []

  function visit(value) {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }

    if (firstPresent(value, ['name', 'title', 'itemName', 'productName', 'description']) && firstPresent(value, ['barcode', 'barCode', 'code', 'itemCode', 'id'])) {
      records.push(value)
    }

    for (const nested of Object.values(value)) visit(nested)
  }

  visit(payload)
  return records
}

function mapCatalogRecord(record) {
  const name = firstPresent(record, ['name', 'title', 'itemName', 'item_name', 'productName', 'product_name', 'description'])
  const externalId = firstPresent(record, ['barcode', 'barCode', 'code', 'itemCode', 'item_code', 'id', 'productId'])
  if (!name || !externalId) return null

  const netContent =
    valueText(firstPresent(record.gs, ['Net_Content'])) ||
    valueText(firstPresent(record.gs?.Product_Dimensions, ['Net_Weight', 'Price_Comparison_Content']))

  return {
    external_id: String(externalId),
    name: String(name).trim(),
    manufacturer:
      valueText(firstPresent(record.gs, ['BrandName'])) ||
      valueText(firstPresent(record, ['manufacturer', 'brandName', 'brand_name', 'supplierName'])),
    unit_qty:
      valueText(firstPresent(record, ['unitQty', 'unit_qty', 'unit', 'size', 'weight', 'measure'])) ||
      netContent ||
      extractUnitFromName(String(name)),
    picture_url: normalizeImage(firstPresent(record, ['image', 'imageUrl', 'image_url', 'pic', 'picture', 'img']) || firstPresent(record.images, ['small', 'original', 'trim', 'transparent'])),
  }
}

function normalizeReceiptFallback(item) {
  const parts = splitReceiptName(item.name)
  const manufacturer = validManufacturer(item.manufacturer) || parts.manufacturer || null
  const unitQty = mergeUnitQty(item.unit_qty, parts.unitQty)

  return {
    ...item,
    name: cleanDisplayName(parts.name, manufacturer, unitQty),
    manufacturer,
    unit_qty: unitQty,
  }
}

async function applyAiNormalization(items) {
  try {
    const normalized = await normalizeReceiptItemsWithAi(items)
    const normalizedByIndex = new Map(normalized.map((item) => [Number(item.index), item]))

    return items.map((item, index) => {
      const aiItem = normalizedByIndex.get(index)
      const confidence = Number(aiItem?.confidence)
      const foodConfidence = Number(aiItem?.food_confidence)
      if (aiItem?.is_food === false && Number.isFinite(foodConfidence) && foodConfidence >= 0.7) return null
      if (!aiItem || !Number.isFinite(confidence) || confidence < 0.7) return item

      const matchedFood = item.match_candidates?.find((food) => String(food.id) === String(aiItem.matched_food_id))
      if (matchedFood) {
        const matched = mergeReceiptItemWithFood(item, matchedFood)
        return {
          ...matched,
          name: preferHebrewText(aiItem.name, matched.name, 'מוצר לא מזוהה'),
          manufacturer: preferHebrewText(aiItem.manufacturer, matched.manufacturer, null),
          unit_qty: singleUnitQty(aiItem.unit_qty || matched.unit_qty),
          matched_food_id: matchedFood.id,
          match_candidates: item.match_candidates,
          is_food: aiItem.is_food,
        }
      }

      return {
        ...item,
        name: preferHebrewText(aiItem.name, item.name, 'מוצר לא מזוהה'),
        manufacturer: preferHebrewText(aiItem.manufacturer, item.manufacturer, null),
        unit_qty: singleUnitQty(aiItem.unit_qty || item.unit_qty),
        is_food: aiItem.is_food,
      }
    }).filter(Boolean)
  } catch {
    // Gemini is optional. Catalog and receipt parsing remain fully functional without it.
    return items
  }
}

function validManufacturer(value) {
  const text = cleanAiText(value)
  if (!text || /^\d+$/.test(text)) return null
  return text
}

function cleanAiText(value) {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  return text && text !== '-' && text.toLowerCase() !== 'null' ? text : null
}

function preferHebrewText(primary, fallback, emptyValue) {
  const primaryText = cleanAiText(primary)
  const fallbackText = cleanAiText(fallback)
  if (primaryText && containsHebrew(primaryText)) return primaryText
  if (fallbackText && containsHebrew(fallbackText)) return fallbackText
  return emptyValue
}

function normalizeReceiptPresentation(item) {
  const manufacturer = preferHebrewText(item.manufacturer, null, null)
  return {
    ...item,
    name: preferHebrewText(item.name, null, 'מוצר לא מזוהה'),
    manufacturer: getFoodCategory(item) === 'פירות וירקות' ? DEFAULT_MANUFACTURER : manufacturer || DEFAULT_MANUFACTURER,
    unit_qty: singleUnitQty(item.unit_qty, item.name),
  }
}

function singleUnitQty(value, productName = '') {
  const text = `${cleanAiText(value) || ''} ${productName || ''}`.trim()
  if (!text || /^0(?:[.,]0+)?(?:\s|$)/.test(text)) return 'יחידה'

  const multipack = text.match(/(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)/i)
  if (multipack) {
    const total = Number(multipack[1].replace(',', '.')) * Number(multipack[2].replace(',', '.'))
    const unit = normalizedUnitFromText(text) || 'יחידות'
    return `${formatUnitAmount(total)} ${unit}`
  }

  const measurement = text.match(/(\d+(?:[.,]\d+)?)\s*(מ["״]?ל|מיליליטר|ליטר|גרם|גר|ג|ק["״]?ג|קג|יחידות|יחידה|יח[׳'])/i)
  if (measurement) {
    const amount = Number(measurement[1].replace(',', '.'))
    if (!amount) return 'יחידה'
    return `${formatUnitAmount(amount)} ${normalizeHebrewUnit(measurement[2]) || 'יחידות'}`
  }

  return 'יחידה'
}

function normalizedUnitFromText(value) {
  const unit = value.match(/מ["״]?ל|מיליליטר|ליטר|גרם|גר|ג|ק["״]?ג|קג|יחידות|יחידה|יח[׳']/i)?.[0]
  return normalizeHebrewUnit(unit)
}

function normalizeHebrewUnit(value = '') {
  if (/^(?:מ["״]?ל|מיליליטר)$/i.test(value)) return 'מ״ל'
  if (/^ליטר$/i.test(value)) return 'ליטר'
  if (/^(?:גרם|גר|ג)$/i.test(value)) return 'גרם'
  if (/^(?:ק["״]?ג|קג)$/i.test(value)) return 'ק״ג'
  if (/^(?:יחידות|יחידה|יח[׳'])$/i.test(value)) return 'יחידות'
  return ''
}

function formatUnitAmount(value) {
  return String(Number(value.toFixed(3)))
}

function containsHebrew(value) {
  return /[\u0590-\u05ff]/.test(String(value || ''))
}

function withReliableReceiptImage(item) {
  const candidates = receiptImageCandidates(item)
  return {
    ...item,
    picture_url: candidates[0] || null,
    image_candidates: candidates,
  }
}

function receiptImageCandidates(item) {
  const barcode = String(item.barcode || '').trim()
  const ramiImages = /^\d{1,14}$/.test(barcode)
    ? [
        `https://img.rami-levy.co.il/product/${barcode}/app/${barcode}.jpg`,
        `https://img.rami-levy.co.il/product/${barcode}/small.jpg`,
        `https://img.rami-levy.co.il/product/${barcode}/large.jpg`,
        `https://img.rami-levy.co.il/product/${barcode}/medium.jpg`,
        `https://img.rami-levy.co.il/product/${barcode}/trim.jpg`,
      ]
    : []
  const currentImages = Array.isArray(item.image_candidates) ? item.image_candidates : [item.picture_url]
  const directCurrentImages = currentImages.filter((url) => String(url || '').includes('img.rami-levy.co.il'))
  const otherCurrentImages = currentImages.filter((url) => !String(url || '').includes('img.rami-levy.co.il'))
  return unique([...directCurrentImages, ...ramiImages, ...otherCurrentImages].filter(Boolean))
}

function mergeDuplicateReceiptItems(items) {
  const mergedItems = []
  const byAlias = new Map()
  for (const item of items) {
    const aliases = receiptItemAliases(item)
    const existing = aliases.map((alias) => byAlias.get(alias)).find(Boolean)
    if (!existing) {
      const copy = { ...item }
      mergedItems.push(copy)
      for (const alias of aliases) byAlias.set(alias, copy)
      continue
    }
    existing.quantity = Math.max(Number(existing.quantity || 0), Number(item.quantity || 0))
    existing.image_candidates = unique([...(existing.image_candidates || []), ...(item.image_candidates || [])])
    for (const alias of aliases) byAlias.set(alias, existing)
  }
  return mergedItems
}

function receiptItemAliases(item) {
  const aliases = []
  if (item.matched_food_id) aliases.push(`food:${item.matched_food_id}`)
  if (item.barcode) aliases.push(`barcode:${normalizeIdentity(item.barcode)}`)
  if (item.external_id) aliases.push(`external:${normalizeIdentity(item.external_id)}`)

  const name = normalizeIdentity(item.name)
  const manufacturer = normalizeIdentity(item.manufacturer)
  const unit = normalizeIdentity(item.unit_qty)
  if (name) {
    aliases.push(`product:${name}|${manufacturer}|${unit}`)
  }
  return unique(aliases)
}

function normalizeIdentity(value) {
  return String(value)
    .toLocaleLowerCase('he')
    .replace(/[^\p{L}\p{N}%]+/gu, '')
}

function isWaterProduct(item) {
  const text = [item?.name, item?.manufacturer]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  return /(?:^|\s)מים(?:\s|$)|מי עדן|נביעות|עין גדי|אקווה נובה/u.test(text)
}

function splitReceiptName(value) {
  let name = value.replace(/\s+/g, ' ').trim()
  const unitQty = extractUnitFromName(name)
  if (unitQty) name = removeUnitFromName(name, unitQty)

  const manufacturer = knownManufacturers.find((brand) => name.includes(brand)) || null
  if (manufacturer) name = name.replace(manufacturer, ' ').replace(/\s+/g, ' ').trim()

  return {
    name: name || value,
    manufacturer,
    unitQty,
  }
}

function cleanDisplayName(value, manufacturer, unitQty) {
  let name = value.replace(/\s+/g, ' ').trim()
  if (manufacturer) name = name.replace(new RegExp(escapeRegex(manufacturer), 'gi'), ' ')
  if (unitQty) {
    name = name.replace(new RegExp(escapeRegex(unitQty), 'gi'), ' ')
    name = removeUnitFromName(name, unitQty)
  }
  name = removePlainNumbersFromName(name)
  return name.replace(/\s+/g, ' ').trim() || value
}

function extractUnitFromName(value) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  const explicit =
    normalized.match(/\b\d+\s*[xX]\s*\d+\b/) ||
    normalized.match(/\b\d+(?:[.,]\d+)?\s*(?:מ"ל|מל|ליטר|גרם|גר|ג|ק"ג|קג|יחידות|יח')\b/i)
  if (explicit) return explicit[0].replace(/\s+/g, ' ').trim()

  const trailingNumber = normalized.match(/\b(\d{1,4})(?!\s*%)\s*$/)
  if (!trailingNumber) {
    return null
  }
  const amount = Number(trailingNumber[1])
  if (!Number.isFinite(amount)) return null
  if (/מים|שישיה|שישייה|מארז|בקבוקים/.test(normalized)) return `${amount} יחידות`
  if (amount <= 1000) return `${amount} מ"ל`
  return null
}

function removeUnitFromName(value, unitQty) {
  let name = value.replace(new RegExp(escapeRegex(unitQty), 'gi'), ' ')
  name = name.replace(/\b\d+\s*[xX]\s*\d+\b/gi, ' ')
  name = name.replace(/\b\d+(?:[.,]\d+)?\s*(?:מ"ל|מל|ליטר|גרם|גר|ג|ק"ג|קג|יחידות|יח')\b/gi, ' ')
  if (/^\d+\s*מ"ל$/.test(unitQty)) {
    name = name.replace(new RegExp(`\\b${escapeRegex(unitQty.replace(/\s*מ"ל$/, ''))}\\b`, 'gi'), ' ')
  }
  return name.replace(/\s+/g, ' ').trim()
}

function removePlainNumbersFromName(value) {
  return value
    .replace(/\b\d+(?:[.,]\d+)?(?!\s*%)(?=\s|$)/g, ' ')
    .replace(/\b\d+\s*[xX]\s*\d+\b/g, ' ')
}

function mergeUnitQty(primary, secondary) {
  return primary || secondary || null
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function firstPresent(record, keys) {
  for (const key of keys) {
    if (record?.[key] !== undefined && record[key] !== null && record[key] !== '') return record[key]
  }
  return null
}

function valueText(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
  if (typeof value !== 'object') return null
  return valueText(value.name || value.title || value.text || value.value)
}

function normalizeImage(value) {
  if (!value) return null
  const image = String(value)
  if (image.startsWith('http://') || image.startsWith('https://')) return image
  if (image.startsWith('//')) return `https:${image}`
  if (image.startsWith('/')) return `https://www.rami-levy.co.il${image}`
  return image
}

function unique(values) {
  return Array.from(new Set(values))
}

const knownManufacturers = [
  'השף הלבן',
  'יופלה',
  'מימונס',
  'מי עדן',
  'גד',
  'רמי לוי',
  'מולט',
  'בריס',
  'ליגורי',
  'ריטר',
  'היינץ',
  'אלטרנטיב',
]
