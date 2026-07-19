import { useCallback, useEffect, useMemo, useState } from 'react'
import FoodFilterBar from './FoodFilterBar'
import ShoppingNotes from './ShoppingNotes'
import TopNotice from './TopNotice'
import { DEFAULT_MANUFACTURER, addInventoryQuantities, applyRelatedRatings, fetchInventoryQuantities, fetchRatingsByOwner, fetchShoppingListItems } from '../lib/foodData'
import { ALL_CATEGORIES, buildCategoryOptions, filterFoodRows, getFoodCategoryLabel, groupItemsByCategory, groupRowsByRatingMood } from '../lib/foodFilters'
import { supabase } from '../lib/supabase'
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh'

const realtimeTables = ['shopping_list', 'ratings']

export default function FulfillmentPage({ session }) {
  const [items, setItems] = useState([])
  const [ratings, setRatings] = useState({})
  const [ownerName, setOwnerName] = useState('')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState(ALL_CATEGORIES)
  const [savingId, setSavingId] = useState(null)
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const ownerId = session.role === 'shopper' ? session.shops_for_user_id : session.user_id

  const loadItems = useCallback(async () => {
    setLoading(true)
    setError('')

    const [listRes, ownerRes, ratingsRes] = await Promise.all([
      fetchShoppingListItems(ownerId),
      supabase.from('users').select('username').eq('id', ownerId).maybeSingle(),
      fetchRatingsByOwner(ownerId),
    ])

    if (listRes.error) {
      setError(listRes.error.message)
      setItems([])
    } else {
      setItems(listRes.data || [])
    }

    if (!ownerRes.error) setOwnerName(ownerRes.data?.username || '')
    if (!ratingsRes.error) {
      const foods = (listRes.data || []).map((item) => item.food).filter(Boolean)
      setRatings(applyRelatedRatings(foods, ratingsRes.data, ratingsRes.rows))
    }
    setLoading(false)
  }, [ownerId])

  useEffect(() => {
    const timeoutId = setTimeout(loadItems, 0)
    return () => clearTimeout(timeoutId)
  }, [loadItems])

  useRealtimeRefresh(`fulfillment-legacy-${ownerId}`, realtimeTables, loadItems)

  const categoryOptions = useMemo(() => buildCategoryOptions(items.map((item) => item.food).filter(Boolean)), [items])
  const filteredItems = useMemo(() => filterFoodRows(items, { category, search }), [category, items, search])
  const pending = filteredItems.filter((item) => !item.in_cart)
  const cartItems = filteredItems.filter((item) => item.in_cart)
  const allCartItems = items.filter((item) => item.in_cart)
  const cartCount = allCartItems.reduce((sum, item) => sum + item.quantity, 0)
  async function setInCart(item, inCart) {
    setSavingId(item.id)
    setError('')
    setSuccess('')
    const previousItems = items
    setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, in_cart: inCart } : entry)))

    const { error: updateError } = await supabase.from('shopping_list').update({ in_cart: inCart }).eq('id', item.id)
    setSavingId(null)

    if (updateError) {
      setItems(previousItems)
      setError(updateError.message)
      return
    }

    await loadItems()
  }

  async function finishShopping() {
    if (allCartItems.length === 0) return

    setFinishing(true)
    setError('')
    setSuccess('')

    const purchasedAt = new Date().toISOString()
    const cartSnapshot = allCartItems
    let inventoryBefore

    try {
      inventoryBefore = await fetchInventoryQuantities(ownerId, cartSnapshot.map((item) => item.food_id))
    } catch {
      inventoryBefore = new Map()
    }

    const { data, error: rpcError } = await supabase.rpc('finish_shopping', {
      p_shopper_id: session.role === 'shopper' ? session.user_id : ownerId,
    })
    setFinishing(false)

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    try {
      await addMissingInventoryQuantities(ownerId, cartSnapshot, inventoryBefore, purchasedAt)
    } catch (inventoryError) {
      setError(inventoryError.message)
      await loadItems()
      return
    }

    setSuccess(`הקניות הסתיימו. עודכנו ${data ?? allCartItems.length} פריטים.`)
    await loadItems()
  }

  if (!ownerId) {
    return (
      <section className="rounded-2xl bg-white p-6 text-center shadow-sm dark:bg-slate-900">
        <h2 className="text-2xl font-black">לא משויך בעלים</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">למשתמש הקונה לא מוגדר `shops_for_user_id`.</p>
      </section>
    )
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
        <h2 className="text-2xl font-black">קניות עבור {ownerName || 'הבעלים'}</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">העבירו פריטים לעגלה ואז סיימו את הקניה.</p>
      </div>

      <ShoppingNotes ownerId={ownerId} session={session} />

      <FoodFilterBar
        category={category}
        categoryOptions={categoryOptions}
        onCategoryChange={setCategory}
        onSearchChange={setSearch}
        placeholder="חיפוש בקניות..."
        search={search}
      />

      {loading ? (
        <EmptyState text="טוען רשימת קניות..." />
      ) : items.length === 0 ? (
        <EmptyState text="אין פריטים מבוקשים כרגע." />
      ) : filteredItems.length === 0 ? (
        <EmptyState text="אין פריטים שמתאימים לסינון הזה." />
      ) : (
        <>
          <ItemSection emptyText="אין פריטים ממתינים." items={pending} onAction={(item) => setInCart(item, true)} pinned ratings={ratings} savingId={savingId} title="מבוקשים" />
          <ItemSection
            actionLabel="החזרה"
            emptyText="העגלה ריקה."
            inCart
            items={cartItems}
            onAction={(item) => setInCart(item, false)}
            ratings={ratings}
            savingId={savingId}
            title="בעגלה"
          />
        </>
      )}

      {allCartItems.length > 0 ? (
        <div className="fixed inset-x-0 bottom-[76px] z-30 px-4">
          <div className="mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-rose-700 p-3 text-white shadow-2xl dark:bg-slate-900 dark:ring-1 dark:ring-cyan-400/40">
            <div>
              <p className="text-xs text-slate-300">פריטים בעגלה</p>
              <p className="font-black">{cartCount} פריטים</p>
            </div>
            <button
              className="rounded-xl bg-white px-4 py-3 font-black text-rose-700 disabled:opacity-60 dark:text-indigo-800"
              disabled={finishing}
              onClick={finishShopping}
              type="button"
            >
              {finishing ? 'מסיים...' : 'סיום קניה'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

async function addMissingInventoryQuantities(ownerId, cartItems, inventoryBefore, purchasedAt) {
  const inventoryAfter = await fetchInventoryQuantities(ownerId, cartItems.map((item) => item.food_id))
  const missing = []

  for (const item of cartItems) {
    const beforeQuantity = inventoryBefore.get(item.food_id) || 0
    const afterQuantity = inventoryAfter.get(item.food_id) || 0
    const missingQuantity = Math.max(0, beforeQuantity + Number(item.quantity || 0) - afterQuantity)

    if (missingQuantity > 0) {
      missing.push({
        item: { quantity: missingQuantity },
        food: { id: item.food_id },
      })
    }
  }

  if (missing.length > 0) await addInventoryQuantities(ownerId, missing, purchasedAt)
}

function ItemSection({ actionLabel = 'הוספה', emptyText, inCart = false, items, onAction, pinned = false, ratings, savingId, title }) {
  const groups = groupRowsByRatingMood(items, ratings)

  return (
    <div className={`space-y-3 ${pinned && items.length > 0 ? 'sticky top-[73px] z-20 rounded-2xl border border-rose-100 bg-orange-50/95 p-2 shadow-xl backdrop-blur dark:border-slate-800 dark:bg-slate-950/95' : ''}`}>
      <h3 className="px-1 text-sm font-black uppercase tracking-wide text-slate-500">{title}</h3>
      {items.length === 0 ? <div className="rounded-2xl bg-white p-4 text-center text-sm text-slate-500 dark:bg-slate-900 dark:text-slate-400">{emptyText}</div> : null}
      {groups.map((group) => (
        <div className="space-y-2" key={group.key}>
          <div className={`flex items-center justify-between border-b-2 px-1 pb-1 ${group.underline || 'border-slate-200 dark:border-slate-700'}`}>
            <h4 className={`text-sm font-black ${group.tone}`}>{group.title}</h4>
            <span className="text-xs font-black text-slate-400">{group.items.length}</span>
          </div>
          {groupItemsByCategory(group.items, (item) => item.food).map((categoryGroup) => (
            <div className="space-y-2" key={categoryGroup.key}>
              <CategorySubheading count={categoryGroup.items.length} title={categoryGroup.title} />
              {categoryGroup.items.map((item) => (
                <article className={`flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ${group.ring} dark:bg-slate-900 ${inCart ? 'outline outline-2 outline-cyan-300' : ''}`} key={item.id}>
                  <FoodThumb food={item.food} />
                  <div className="min-w-0 flex-1">
                    <h4 className="line-clamp-2 font-black leading-tight">{item.food?.name || 'מוצר שנמחק'}</h4>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{item.food?.manufacturer || DEFAULT_MANUFACTURER}</p>
                    <p className="mt-1 text-sm font-black text-rose-700 dark:text-cyan-300">{item.food?.unit_qty || 'יחידת מידה לא צוינה'}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-black">
                      <span className={`rounded-lg px-2 py-1 ${group.badge}`}>{group.title}</span>
                      <span className="rounded-lg bg-slate-100 px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{getFoodCategoryLabel(item.food)}</span>
                    </div>
                  </div>
                  <span className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-black dark:bg-slate-800">x{item.quantity}</span>
                  <button
                    className={`h-11 rounded-xl px-4 font-black disabled:opacity-50 ${
                      inCart ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200' : 'bg-rose-600 text-white'
                    }`}
                    disabled={savingId === item.id}
                    onClick={() => onAction(item)}
                    type="button"
                  >
                    {actionLabel}
                  </button>
                </article>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function CategorySubheading({ count, title }) {
  return (
    <div className="flex items-center justify-between px-2 pt-1">
      <h4 className="text-sm font-black text-slate-600 dark:text-slate-300">{title}</h4>
      <span className="text-xs font-black text-slate-400 dark:text-slate-500">{count}</span>
    </div>
  )
}

function FoodThumb({ food }) {
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-cyan-100 dark:bg-slate-800">
      {food?.picture_url ? (
        <img alt="" className="h-full w-full object-cover" src={food.picture_url} />
      ) : (
        <span className="font-black text-rose-500">{food?.name?.slice(0, 1) || '?'}</span>
      )}
    </div>
  )
}

function EmptyState({ text }) {
  return <div className="rounded-2xl border border-dashed border-rose-200 bg-white p-8 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">{text}</div>
}
