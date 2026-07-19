import { useCallback, useEffect, useMemo, useState } from 'react'
import TopNotice from './TopNotice'
import { formatDate } from '../lib/format'
import { fetchShoppingListItems } from '../lib/foodData'
import { isNonFoodProduct } from '../lib/productRules'

export default function RequestBoardPage({ onStartShopping, session }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadRows = useCallback(async () => {
    setLoading(true)
    setError('')

    const { data, error: queryError } = await fetchShoppingListItems(session)

    if (queryError) {
      setError(queryError.message)
      setRows([])
    } else {
      setRows((data || [])
        .filter((row) => !row.in_cart && !isNonFoodProduct(row.food))
        .map((row) => ({ ...row, owner: { id: session.owner_id, username: session.family_name } })))
    }

    setLoading(false)
  }, [session])

  useEffect(() => {
    const timeoutId = setTimeout(loadRows, 0)
    const intervalId = setInterval(loadRows, 15_000)
    return () => {
      clearTimeout(timeoutId)
      clearInterval(intervalId)
    }
  }, [loadRows])

  const groups = useMemo(() => {
    const map = new Map()
    for (const row of rows) {
      const key = row.owner_id
      const group = map.get(key) || { owner: row.owner, items: [] }
      group.items.push(row)
      map.set(key, group)
    }
    return Array.from(map.values())
  }, [rows])

  return (
    <section className="space-y-4">
      <TopNotice notice={error ? { tone: 'error', text: error } : null} onDismiss={() => setError('')} />

      <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
        <h2 className="text-2xl font-black">לוח בקשות</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">בקשות פתוחות של משתמשים אחרים. החדשות מוצמדות למעלה.</p>
      </div>

      {loading ? (
        <EmptyState text="טוען לוח בקשות..." />
      ) : groups.length === 0 ? (
        <EmptyState text="אין כרגע בקשות פתוחות." />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <OwnerGroup group={group} key={group.owner?.id || group.items[0]?.owner_id} onStartShopping={onStartShopping} session={session} />
          ))}
        </div>
      )}
    </section>
  )
}

function OwnerGroup({ group, onStartShopping, session }) {
  const canShopThisOwner = session.role === 'shopper' && session.shops_for_user_id === group.owner?.id

  return (
    <article className="overflow-hidden rounded-2xl bg-white shadow-sm dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3 border-b border-rose-100 p-4 dark:border-slate-800">
        <div>
          <h3 className="text-lg font-black">{group.owner?.username || 'משתמש לא ידוע'}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {group.items.length} מוצרים
          </p>
        </div>
        {canShopThisOwner ? (
          <button className="rounded-xl bg-rose-600 px-4 py-3 font-black text-white dark:bg-cyan-400 dark:text-slate-950" onClick={onStartShopping} type="button">
            קניות
          </button>
        ) : null}
      </div>
      <div className="divide-y divide-rose-50 dark:divide-slate-800">
        {group.items.map((item) => (
          <div className="flex items-center gap-3 p-3" key={item.id}>
            <FoodThumb food={item.food} />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 font-black leading-tight">{item.food?.name || 'מוצר שנמחק'}</p>
              <p className="mt-1 text-sm font-black text-rose-700 dark:text-cyan-300">{item.food?.unit_qty || 'יחידת מידה לא צוינה'}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formatDate(item.added_at)}</p>
            </div>
            <span className="rounded-xl bg-cyan-100 px-3 py-2 text-sm font-black text-cyan-950 dark:bg-cyan-400 dark:text-slate-950">x{item.quantity}</span>
          </div>
        ))}
      </div>
    </article>
  )
}

function FoodThumb({ food }) {
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-cyan-100 dark:bg-slate-800">
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
