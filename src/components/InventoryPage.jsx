import { useCallback, useEffect, useMemo, useState } from 'react'
import FoodFilterBar from './FoodFilterBar'
import TopNotice from './TopNotice'
import { DEFAULT_MANUFACTURER, applyRelatedRatings, fetchInventoryRows, fetchRatingsByOwner, setInventoryQuantity } from '../lib/foodData'
import { ALL_CATEGORIES, buildCategoryOptions, filterFoodRows, getFoodCategoryLabel, groupItemsByCategory, groupRowsByRank, groupRowsByRatingMood } from '../lib/foodFilters'
import { formatDate } from '../lib/format'
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh'

const realtimeTables = ['inventory', 'ratings']

export default function InventoryPage({ session }) {
  const [rows, setRows] = useState([])
  const [ratings, setRatings] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState(ALL_CATEGORIES)
  const [notice, setNotice] = useState(null)
  const [adjustingKey, setAdjustingKey] = useState('')

  const ownerId = session.role === 'shopper' ? session.shops_for_user_id : session.user_id

  const loadInventory = useCallback(async () => {
    if (!ownerId) return

    setLoading(true)

    const [inventoryResult, ratingsResult] = await Promise.all([
      fetchInventoryRows(ownerId),
      fetchRatingsByOwner(ownerId),
    ])

    if (inventoryResult.error) {
      setNotice({ tone: 'error', text: inventoryResult.error.message })
      setRows([])
    } else {
      setRows(sortInventoryRows(inventoryResult.data || []))
    }

    if (!ratingsResult.error) {
      const foods = (inventoryResult.data || []).map((row) => row.food).filter(Boolean)
      setRatings(applyRelatedRatings(foods, ratingsResult.data, ratingsResult.rows))
    }
    setLoading(false)
  }, [ownerId])

  useEffect(() => {
    const timeoutId = setTimeout(loadInventory, 0)
    return () => clearTimeout(timeoutId)
  }, [loadInventory])

  useRealtimeRefresh(ownerId ? `inventory-${ownerId}` : null, realtimeTables, loadInventory)

  const categoryOptions = useMemo(() => buildCategoryOptions(rows.map((row) => row.food).filter(Boolean)), [rows])
  const filteredRows = useMemo(
    () => filterFoodRows(rows, { category, search }),
    [category, rows, search]
  )
  const rankedGroups = useMemo(
    () => (session.role === 'shopper' ? groupRowsByRatingMood(filteredRows, ratings) : groupRowsByRank(filteredRows, ratings)),
    [filteredRows, ratings, session.role]
  )

  async function changeInventoryQuantity(row, delta) {
    const foodId = row.food_id || row.food?.id
    const rowKey = inventoryRowKey(row)
    const nextQuantity = Math.max(0, Number(row.quantity || 0) + delta)

    setAdjustingKey(rowKey)
    setNotice(null)

    try {
      await setInventoryQuantity(ownerId, foodId, nextQuantity)
      setRows((current) =>
        nextQuantity <= 0
          ? current.filter((entry) => inventoryRowKey(entry) !== rowKey)
          : current.map((entry) => (inventoryRowKey(entry) === rowKey ? { ...entry, quantity: nextQuantity } : entry))
      )
      setNotice({ tone: 'success', text: nextQuantity <= 0 ? 'המוצר הוסר מהמלאי.' : 'הכמות עודכנה.' })
    } catch (quantityError) {
      setNotice({ tone: 'error', text: quantityError.message })
    } finally {
      setAdjustingKey('')
    }
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
      <TopNotice notice={notice} onDismiss={() => setNotice(null)} />

      <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
        <h2 className="text-2xl font-black">מלאי</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">כמויות בבית לפי רכישות וקבלות שנוספו.</p>
      </div>

      <FoodFilterBar
        category={category}
        categoryOptions={categoryOptions}
        onCategoryChange={setCategory}
        onSearchChange={setSearch}
        placeholder="חיפוש במלאי..."
        search={search}
      />

      {loading ? (
        <EmptyState text="טוען מלאי..." />
      ) : rows.length === 0 ? (
        <EmptyState text="אין עדיין מוצרים במלאי." />
      ) : filteredRows.length === 0 ? (
        <EmptyState text="אין מוצרים שמתאימים לסינון הזה." />
      ) : (
        <div className="space-y-5">
          {rankedGroups.map((group) => (
            <section className="space-y-3" key={group.key}>
              <div className={`flex items-center justify-between border-b-2 px-1 pb-1 ${group.underline || 'border-slate-200 dark:border-slate-700'}`}>
                <h3 className={`text-base font-black ${group.tone}`}>{group.title}</h3>
                <span className="text-sm font-black text-slate-500 dark:text-slate-400">{group.items.length}</span>
              </div>
              {groupItemsByCategory(group.items, (row) => row.food).map((categoryGroup) => (
                <div className="space-y-2" key={categoryGroup.key}>
                  <CategorySubheading count={categoryGroup.items.length} title={categoryGroup.title} />
                  {categoryGroup.items.map((row) => (
                    <InventoryRow
                      group={group}
                      isAdjusting={adjustingKey === inventoryRowKey(row)}
                      key={inventoryRowKey(row)}
                      onDecrease={() => changeInventoryQuantity(row, -1)}
                      onIncrease={() => changeInventoryQuantity(row, 1)}
                      row={row}
                    />
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </section>
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

function InventoryRow({ group, isAdjusting, onDecrease, onIncrease, row }) {
  const date = inventoryAddedDate(row)

  return (
    <article className={`rounded-2xl bg-white p-3 shadow-sm ring-1 ${group.ring} dark:bg-slate-900`}>
      <div className="flex items-center gap-3">
        <FoodThumb food={row.food} />
        <div className="min-w-0 flex-1">
          <h4 className="line-clamp-2 font-black leading-tight">{row.food?.name || 'מוצר שנמחק'}</h4>
          <p className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">{row.food?.manufacturer || DEFAULT_MANUFACTURER}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-black">
            <span className={`rounded-lg px-2 py-1 ${group.badge}`}>{group.title}</span>
            <span className="rounded-lg bg-slate-100 px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{getFoodCategoryLabel(row.food)}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end text-left">
          <div className="inline-flex w-auto items-center rounded-xl bg-cyan-100 p-1 text-cyan-950 dark:bg-cyan-400 dark:text-slate-950">
            <button
              aria-label="הפחתת כמות"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-lg font-black transition hover:bg-white/45 disabled:opacity-50 dark:hover:bg-slate-950/10"
              disabled={isAdjusting}
              onClick={onDecrease}
              type="button"
            >
              -
            </button>
            <span className="px-2 text-center text-sm font-black leading-none">x{row.quantity}</span>
            <button
              aria-label="הגדלת כמות"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-lg font-black transition hover:bg-white/45 disabled:opacity-50 dark:hover:bg-slate-950/10"
              disabled={isAdjusting}
              onClick={onIncrease}
              type="button"
            >
              +
            </button>
          </div>
          <span className="mt-2 block max-w-32 text-xs font-bold leading-tight text-slate-500 dark:text-slate-400">
            {date ? `תאריך הוספה: ${formatDate(date)}` : 'תאריך הוספה: לא זמין'}
          </span>
        </div>
      </div>
    </article>
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

function inventoryAddedDate(row) {
  return row.added_at || row.created_at || row.last_purchased_at || row.purchased_at || row.purchase_date || row.updated_at || ''
}

function sortInventoryRows(rows) {
  return [...rows].sort((a, b) => {
    const aDate = new Date(inventoryAddedDate(a) || 0).getTime()
    const bDate = new Date(inventoryAddedDate(b) || 0).getTime()
    return bDate - aDate
  })
}

function inventoryRowKey(row) {
  return `${row.owner_id || 'owner'}:${row.food_id || row.food?.id || 'food'}`
}
