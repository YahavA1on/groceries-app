import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNotifications } from '../lib/notifications'

export default function InventoryView({ session }) {
  const { notifyError } = useNotifications()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [syncingByFoodId, setSyncingByFoodId] = useState({})

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data, error } = await supabase
      .from('inventory')
      .select('food_id, quantity, last_updated, food:foods(id, name, manufacturer, picture_url, unit_qty, price)')
      .eq('owner_id', session.user_id)
      .gt('quantity', 0)
      .order('last_updated', { ascending: false })
    if (error) { console.error(error); setLoading(false); return }
    setItems(data || [])
    setLoading(false)
  }

  async function changeQty(item, delta) {
    if (syncingByFoodId[item.food_id]) return

    const previousQty = item.quantity
    const newQty = item.quantity + delta
    const nextQty = Math.max(newQty, 0)

    setSyncingByFoodId((prev) => ({ ...prev, [item.food_id]: true }))

    // Optimistic UI update so plus/minus feels immediate.
    if (nextQty <= 0) {
      setItems((prev) => prev.filter((i) => i.food_id !== item.food_id))
    } else {
      setItems((prev) => prev.map((i) =>
        i.food_id === item.food_id ? { ...i, quantity: nextQty } : i
      ))
    }

    let error = null
    if (newQty <= 0) {
      const result = await supabase.from('inventory').delete()
        .eq('owner_id', session.user_id)
        .eq('food_id', item.food_id)
      error = result.error
    } else {
      const result = await supabase.from('inventory')
        .update({ quantity: nextQty, last_updated: new Date().toISOString() })
        .eq('owner_id', session.user_id)
        .eq('food_id', item.food_id)
      error = result.error
    }

    if (error) {
      // Roll back optimistic change on failure.
      if (previousQty <= 0) {
        setItems((prev) => prev.filter((i) => i.food_id !== item.food_id))
      } else {
        setItems((prev) => {
          const exists = prev.some((i) => i.food_id === item.food_id)
          if (exists) {
            return prev.map((i) => i.food_id === item.food_id ? { ...i, quantity: previousQty } : i)
          }
          return [{ ...item, quantity: previousQty }, ...prev]
        })
      }
      notifyError(error.message)
    }

    setSyncingByFoodId((prev) => {
      const updated = { ...prev }
      delete updated[item.food_id]
      return updated
    })
  }

  if (loading) return <div className="loading">טוען...</div>

  const q = search.toLowerCase().trim()
  const filtered = q
    ? items.filter((i) =>
        i.food.name.toLowerCase().includes(q) ||
        (i.food.manufacturer && i.food.manufacturer.toLowerCase().includes(q)))
    : items

  if (items.length === 0) {
    return (
      <div className="loading">
        <p>אין פריטים במלאי</p>
        <p className="muted">פריטים שאורלי תקנה יופיעו כאן אוטומטית</p>
      </div>
    )
  }

  return (
    <>
      <div className="search-container">
        <input
          type="search"
          placeholder="חיפוש במלאי..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && <button className="clear-search" onClick={() => setSearch('')}>✕</button>}
      </div>

      <div className="food-list">
        {filtered.map((item) => (
          <div key={item.food_id} className="food-card in-cart">
            <div className="food-img">
              {item.food.picture_url ? (
                <img src={item.food.picture_url} alt="" onError={(e) => (e.target.style.display = 'none')} />
              ) : (
                <div className="placeholder">{item.food.name[0]}</div>
              )}
            </div>
            <div className="food-info">
              <strong>{item.food.name}</strong>
              {item.food.manufacturer && <small>{item.food.manufacturer}</small>}
              {item.food.unit_qty && <div className="food-meta">{item.food.unit_qty}</div>}
            </div>
            <div className="qty-controls" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => changeQty(item, -1)} disabled={!!syncingByFoodId[item.food_id]}>−</button>
              <span className="qty">{item.quantity}</span>
              <button onClick={() => changeQty(item, +1)} disabled={!!syncingByFoodId[item.food_id]}>+</button>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && q && (
        <p className="muted">לא נמצאו פריטים עבור "{search}"</p>
      )}
    </>
  )
}