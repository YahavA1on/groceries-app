import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function InventoryView({ session }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

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
    const newQty = item.quantity + delta
    if (newQty <= 0) {
      await supabase.from('inventory').delete()
        .eq('owner_id', session.user_id)
        .eq('food_id', item.food_id)
      setItems((prev) => prev.filter((i) => i.food_id !== item.food_id))
    } else {
      const { error } = await supabase.from('inventory')
        .update({ quantity: newQty, last_updated: new Date().toISOString() })
        .eq('owner_id', session.user_id)
        .eq('food_id', item.food_id)
      if (error) { alert(error.message); return }
      setItems((prev) => prev.map((i) =>
        i.food_id === item.food_id ? { ...i, quantity: newQty } : i
      ))
    }
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
              <button onClick={() => changeQty(item, -1)}>−</button>
              <span className="qty">{item.quantity}</span>
              <button onClick={() => changeQty(item, +1)}>+</button>
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