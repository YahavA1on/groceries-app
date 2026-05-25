import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getTheme, toggleTheme } from '../lib/theme'
import InventoryView from './InventoryView'
import ShoppingListQR from './ShoppingListQR'

const categoryFor = (r) => {
  if (r == null) return 'unrated'
  if (r >= 8) return 'green'
  if (r >= 5) return 'yellow'
  return 'orange'
}
const colors = { green: '#22c55e', yellow: '#eab308', orange: '#f97316', unrated: '#888' }
const labels = {
  green:   '💚 הוא אוהב',
  yellow:  '💛 בסדר לו',
  orange:  '🧡 פחות אוהב',
  unrated: '⚪ לא דורג',
}

export default function ShopperHome({ session, onLogout }) {
  const [tab, setTab] = useState('shop')
  const [foods, setFoods] = useState([])
  const [ratings, setRatings] = useState({})
  const [inventory, setInventory] = useState({})
  const [cart, setCart] = useState({})
  const [ownerName, setOwnerName] = useState('')
  const [loading, setLoading] = useState(true)
  const [finishing, setFinishing] = useState(false)
  const [search, setSearch] = useState('')
  const [theme, setTheme] = useState(getTheme())
  const [showReceiptScanner, setShowReceiptScanner] = useState(false)

  const ownerId = session.shops_for_user_id

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [foodsRes, ratingsRes, cartRes, ownerRes, inventoryRes] = await Promise.all([
      supabase.from('foods').select('id, name, manufacturer, price, picture_url, unit_qty').order('name'),
      supabase.from('ratings').select('food_id, rating').eq('owner_id', ownerId),
      supabase.from('shopping_list').select('id, food_id, quantity, in_cart').eq('owner_id', ownerId),
      supabase.from('users').select('username').eq('id', ownerId).single(),
      supabase.from('inventory').select('food_id, quantity').eq('owner_id', ownerId).gt('quantity', 0),
    ])
    setFoods(foodsRes.data || [])
    const rMap = {}
    for (const r of ratingsRes.data || []) rMap[r.food_id] = r.rating
    setRatings(rMap)
    const cMap = {}
    for (const c of cartRes.data || []) cMap[c.food_id] = c
    setCart(cMap)
    setOwnerName(ownerRes.data?.username || '')
    const invMap = {}
    for (const inv of inventoryRes.data || []) invMap[inv.food_id] = inv.quantity
    setInventory(invMap)
    setLoading(false)
  }

  async function addToCart(food) {
    const { data, error } = await supabase
      .from('shopping_list')
      .insert({ owner_id: ownerId, food_id: food.id, in_cart: true, quantity: 1 })
      .select().single()
    if (error) { alert(error.message); return }
    setCart((prev) => ({ ...prev, [food.id]: data }))
  }

  async function changeQty(food, delta) {
    const existing = cart[food.id]
    if (!existing) return
    const newQty = existing.quantity + delta
    if (newQty <= 0) {
      await supabase.from('shopping_list').delete().eq('id', existing.id)
      setCart((prev) => { const n = { ...prev }; delete n[food.id]; return n })
    } else {
      const { data, error } = await supabase
        .from('shopping_list')
        .update({ quantity: newQty })
        .eq('id', existing.id)
        .select().single()
      if (error) { alert(error.message); return }
      setCart((prev) => ({ ...prev, [food.id]: data }))
    }
  }

  async function finishShopping() {
    if (Object.keys(cart).length === 0) return
    if (!confirm('לסיים את הקניות ולעדכן את המלאי?')) return
    setFinishing(true)
    const { data, error } = await supabase.rpc('finish_shopping', { p_shopper_id: session.user_id })
    setFinishing(false)
    if (error) { alert(error.message); return }
    alert(`נרשמו ${data} פריטים במלאי 🎉`)
    loadData()
  }

  const handleThemeToggle = () => {
    const newTheme = toggleTheme()
    setTheme(newTheme)
  }

  if (loading) return <div className="loading">טוען...</div>

  const q = search.toLowerCase().trim()
  const matches = (f) => !q || f.name.toLowerCase().includes(q) || (f.manufacturer && f.manufacturer.toLowerCase().includes(q))

  const grouped = { green: [], yellow: [], orange: [], unrated: [] }
  for (const f of foods) {
    if (!matches(f)) continue
    const rating = ratings[f.id]
    grouped[categoryFor(rating)].push({ ...f, rating })
  }
  for (const c of ['green', 'yellow', 'orange']) grouped[c].sort((a, b) => b.rating - a.rating)

  const cartItems = Object.values(cart)
  const cartCount = cartItems.reduce((s, i) => s + i.quantity, 0)

  return (
    <div className="shopper-home">
      <header>
        <div style={{ textAlign: 'right', flex: 1 }}>
          <h1>שלום {session.username}</h1>
          {ownerName && <small>קונה עבור {ownerName}</small>}
        </div>
        <div className="header-actions">
          <button className="theme-toggle" onClick={handleThemeToggle} title="החלף מצב">
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button onClick={onLogout}>יציאה</button>
        </div>
      </header>

      <nav className="tab-nav">
        <button className={tab === 'shop' ? 'active' : ''} onClick={() => setTab('shop')}>
          קניות
        </button>
        <button className={tab === 'inventory' ? 'active' : ''} onClick={() => setTab('inventory')}>
          מלאי
        </button>
      </nav>

      {tab === 'shop' && (
        <>
          <div className="search-container">
            <input
              type="search"
              placeholder="חיפוש מוצר..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="clear-search" onClick={() => setSearch('')}>✕</button>
            )}
          </div>

          {['green', 'yellow', 'orange', 'unrated'].map((cat) => (
            grouped[cat].length > 0 && (
              <section key={cat}>
                <h2 style={{ color: colors[cat] }}>
                  {labels[cat]} <span className="count">({grouped[cat].length})</span>
                </h2>
                <div className="food-list">
                  {grouped[cat].map((food) => (
                    <ShopFoodCard
                      key={food.id}
                      food={food}
                      inCart={!!cart[food.id]}
                      quantity={cart[food.id]?.quantity}
                      inventoryQty={inventory[food.id]}
                      onAdd={() => addToCart(food)}
                      onInc={() => changeQty(food, +1)}
                      onDec={() => changeQty(food, -1)}
                    />
                  ))}
                </div>
              </section>
            )
          ))}

          {q && Object.values(grouped).every(g => g.length === 0) && (
            <p className="muted">לא נמצאו מוצרים עבור "{search}"</p>
          )}

          {cartCount > 0 && (
            <div className="cart-bar">
              <div className="cart-info">
                <strong>{cartCount} פריטים</strong>
              </div>
              <button className="finish-btn" onClick={finishShopping} disabled={finishing}>
                {finishing ? 'טוען...' : 'סיים קניות'}
              </button>
            </div>
          )}
        </>
      )}

      {tab === 'inventory' && (
        <>
          {showReceiptScanner && (
            <ShoppingListQR 
              session={{ user_id: ownerId }}
              foods={foods}
              onClose={() => setShowReceiptScanner(false)}
              onItemsAdded={loadData}
            />
          )}
          <div style={{ marginBottom: showReceiptScanner ? 0 : '2rem' }}>
            <button 
              className="scan-receipt-btn"
              onClick={() => setShowReceiptScanner(true)}
              style={{ marginBottom: '1rem', width: '100%' }}
            >
              📸 סרוק קוד QR מקבלה
            </button>
            <InventoryView session={{ user_id: ownerId }} />
          </div>
        </>
      )}
    </div>
  )
}

function ShopFoodCard({ food, inCart, quantity, inventoryQty, onAdd, onInc, onDec }) {
  return (
    <div
      className={`food-card ${inCart ? 'in-cart' : ''}`}
      onClick={inCart ? undefined : onAdd}
    >
      <div className="food-img">
        {food.picture_url ? (
          <img src={food.picture_url} alt="" onError={(e) => (e.target.style.display = 'none')} />
        ) : (
          <div className="placeholder">{food.name[0]}</div>
        )}
      </div>
      <div className="food-info">
        <strong>{food.name}</strong>
        {food.manufacturer && <small>{food.manufacturer}</small>}
        <div className="food-meta">
          {food.unit_qty && <span>{food.unit_qty}</span>}
          {inventoryQty && <span className="inventory-indicator"> · 📦 {inventoryQty}</span>}
        </div>
      </div>
      {inCart ? (
        <div className="qty-controls" onClick={(e) => e.stopPropagation()}>
          <button onClick={onDec}>−</button>
          <span className="qty">{quantity}</span>
          <button onClick={onInc}>+</button>
        </div>
      ) : (
        food.rating && <span className="rating-badge">★ {food.rating}</span>
      )}
    </div>
  )
}