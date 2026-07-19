import { useCallback, useEffect, useMemo, useState } from 'react'
import FoodFilterBar from './FoodFilterBar'
import ShoppingNotes from './ShoppingNotes'
import TopNotice from './TopNotice'
import { DEFAULT_MANUFACTURER, applyRelatedRatings, deleteShoppingItem, fetchRatingsByOwner, fetchShoppingListItems, setShoppingItemQuantity } from '../lib/foodData'
import { ALL_CATEGORIES, buildCategoryOptions, filterFoodRows, getFoodCategoryLabel, groupRowsByRank } from '../lib/foodFilters'

export default function MyRequestsPage({ session }) {
  const [items, setItems] = useState([])
  const [ratings, setRatings] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState(ALL_CATEGORIES)
  const [savingId, setSavingId] = useState(null)
  const [error, setError] = useState('')

  const loadItems = useCallback(async () => {
    setLoading(true)
    setError('')

    const [itemsResult, ratingsResult] = await Promise.all([
      fetchShoppingListItems(session),
      fetchRatingsByOwner(session),
    ])

    if (itemsResult.error) {
      setError(itemsResult.error.message)
      setItems([])
    } else {
      setItems(itemsResult.data || [])
    }

    if (!ratingsResult.error) {
      const foods = (itemsResult.data || []).map((item) => item.food).filter(Boolean)
      setRatings(applyRelatedRatings(foods, ratingsResult.data, ratingsResult.rows))
    }
    setLoading(false)
  }, [session])

  useEffect(() => {
    const timeoutId = setTimeout(loadItems, 0)
    const intervalId = setInterval(loadItems, 15_000)
    return () => {
      clearTimeout(timeoutId)
      clearInterval(intervalId)
    }
  }, [loadItems])

  const categoryOptions = useMemo(() => buildCategoryOptions(items.map((item) => item.food).filter(Boolean)), [items])
  const filteredItems = useMemo(() => filterFoodRows(items, { category, search }), [category, items, search])
  const pending = filteredItems.filter((item) => !item.in_cart)
  const inCart = filteredItems.filter((item) => item.in_cart)

  async function changeQuantity(item, delta) {
    setSavingId(item.id)
    setError('')

    const nextQuantity = item.quantity + delta
    const result = nextQuantity <= 0
      ? await deleteShoppingItem(session, item.id)
      : await setShoppingItemQuantity(session, item.id, nextQuantity)

    setSavingId(null)

    if (result.error) {
      setError(result.error.message)
      return
    }

    await loadItems()
  }

  async function removeItem(item) {
    setSavingId(item.id)
    setError('')

    const { error: deleteError } = await deleteShoppingItem(session, item.id)
    setSavingId(null)

    if (deleteError) {
      setError(deleteError.message)
      return
    }

    await loadItems()
  }

  return (
    <section className="space-y-4">
      <TopNotice notice={error ? { tone: 'error', text: error } : null} onDismiss={() => setError('')} />

      <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
        <h2 className="text-2xl font-black">הבקשות שלי</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">פריטים שממתינים לקונה ופריטים שכבר נכנסו לעגלה.</p>
      </div>

      <ShoppingNotes session={session} />

      <FoodFilterBar
        category={category}
        categoryOptions={categoryOptions}
        onCategoryChange={setCategory}
        onSearchChange={setSearch}
        placeholder="חיפוש בבקשות..."
        search={search}
      />

      {loading ? (
        <EmptyState text="טוען בקשות..." />
      ) : items.length === 0 ? (
        <EmptyState text="עוד אין בקשות." />
      ) : filteredItems.length === 0 ? (
        <EmptyState text="אין בקשות שמתאימות לסינון הזה." />
      ) : (
        <>
          <RequestSection
            editable
            items={pending}
            onChangeQuantity={changeQuantity}
            onRemove={removeItem}
            pinned
            ratings={ratings}
            savingId={savingId}
            title="ממתין לקונה"
          />
          <RequestSection items={inCart} ratings={ratings} savingId={savingId} title="בעגלת הקונה" />
        </>
      )}
    </section>
  )
}

function RequestSection({ editable = false, items, onChangeQuantity, onRemove, pinned = false, ratings, savingId, title }) {
  if (items.length === 0) return null

  const groups = groupRowsByRank(items, ratings)

  return (
    <div className={`space-y-3 ${pinned ? 'sticky top-[73px] z-20 rounded-2xl border border-rose-100 bg-orange-50/95 p-2 shadow-xl backdrop-blur dark:border-slate-800 dark:bg-slate-950/95' : ''}`}>
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">{title}</h3>
        <span className="text-sm font-black text-rose-700 dark:text-cyan-300">{items.length} מוצרים</span>
      </div>
      {groups.map((group) => (
        <div className="space-y-2" key={group.key}>
          <div className="flex items-center justify-between px-1">
            <h4 className={`text-sm font-black ${group.tone}`}>{group.title}</h4>
            <span className="text-xs font-black text-slate-400">{group.items.length}</span>
          </div>
          {group.items.map((item) => (
            <article className={`rounded-2xl bg-white p-3 shadow-sm ring-1 ${group.ring} dark:bg-slate-900`} key={item.id}>
              <div className="flex items-center gap-3">
                <FoodThumb food={item.food} />
                <div className="min-w-0 flex-1">
                  <h4 className="line-clamp-2 font-black leading-tight">{item.food?.name || 'מוצר שנמחק'}</h4>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{item.food?.manufacturer || DEFAULT_MANUFACTURER}</p>
                  <p className="mt-1 text-sm font-black text-rose-700 dark:text-cyan-300">{item.food?.unit_qty || 'יחידת מידה לא צוינה'}</p>
                  <span className="mt-2 inline-flex rounded-lg bg-slate-100 px-2 py-1 text-xs font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">{getFoodCategoryLabel(item.food)}</span>
                </div>
                {editable ? (
                  <div className="flex items-center rounded-xl border border-rose-200 dark:border-slate-700">
                    <button
                      className="h-10 w-10 text-xl font-black disabled:opacity-50"
                      disabled={savingId === item.id}
                      onClick={() => onChangeQuantity(item, -1)}
                      type="button"
                    >
                      -
                    </button>
                    <span className="min-w-7 text-center font-black">{item.quantity}</span>
                    <button
                      className="h-10 w-10 text-xl font-black disabled:opacity-50"
                      disabled={savingId === item.id}
                      onClick={() => onChangeQuantity(item, 1)}
                      type="button"
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <span className="rounded-xl bg-cyan-100 px-3 py-2 text-sm font-black text-cyan-950 dark:bg-cyan-400 dark:text-slate-950">x{item.quantity}</span>
                )}
              </div>
              {editable ? (
                <button
                  aria-label={`הסרת ${item.food?.name || 'מוצר'}`}
                  className="mt-3 flex h-10 w-full items-center justify-center rounded-xl bg-rose-50 text-lg font-black text-rose-700 disabled:opacity-50 dark:bg-rose-500/10 dark:text-rose-200"
                  disabled={savingId === item.id}
                  onClick={() => onRemove(item)}
                  title="הסרה"
                  type="button"
                >
                  🗑
                </button>
              ) : null}
            </article>
          ))}
        </div>
      ))}
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
