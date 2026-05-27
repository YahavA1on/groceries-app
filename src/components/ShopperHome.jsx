import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getTheme, toggleTheme } from '../lib/theme'
import InventoryView from './InventoryView'
import ShoppingListQR from './ShoppingListQR'
import ConfirmDialog from './ConfirmDialog'
import { ALL_CATEGORY_KEY, ALL_CATEGORY_LABEL, CATEGORY_FILTERS, getFoodCategory } from '../lib/foodCategories'
import { useNotifications } from '../lib/notifications'

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
  const { notifySuccess, notifyError } = useNotifications()
  const [tab, setTab] = useState('shop')
  const [foods, setFoods] = useState([])
  const [ratings, setRatings] = useState({})
  const [inventory, setInventory] = useState({})
  const [cart, setCart] = useState({})
  const [requests, setRequests] = useState({})
  const [requestTargets, setRequestTargets] = useState({})
  const [ownerName, setOwnerName] = useState('')
  const [loading, setLoading] = useState(true)
  const [finishing, setFinishing] = useState(false)
  const [showFinishConfirm, setShowFinishConfirm] = useState(false)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORY_KEY)
  const [viewMode, setViewMode] = useState('list')
  const [theme, setTheme] = useState(getTheme())
  const [showReceiptScanner, setShowReceiptScanner] = useState(false)
  const cartRef = useRef({})

  const ownerId = session.shops_for_user_id

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    cartRef.current = cart
  }, [cart])

  useEffect(() => {
    const channel = supabase
      .channel(`shopper-requests-${ownerId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shopping_list' },
        () => refreshPendingRequestsRealtime()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [ownerId])

  useEffect(() => {
    const intervalId = setInterval(() => {
      refreshPendingRequestsRealtime()
    }, 5000)

    return () => clearInterval(intervalId)
  }, [ownerId])

  async function refreshPendingRequestsRealtime() {
    const { data } = await supabase
      .from('shopping_list')
      .select('id, food_id, quantity, in_cart')
      .eq('owner_id', ownerId)
      .eq('in_cart', false)

    const pending = data || []
    const pendingMap = {}
    const targetsFromServer = {}

    for (const row of pending) {
      targetsFromServer[row.food_id] = row.quantity
      if (cartRef.current[row.food_id]) continue
      pendingMap[row.food_id] = row
    }

    setRequests(pendingMap)
    setRequestTargets(targetsFromServer)
  }

  async function syncShoppingListState() {
    const cartRows = Object.values(cart).map((item) => ({
      owner_id: ownerId,
      food_id: item.food_id,
      quantity: item.quantity,
      in_cart: true,
    }))
    const requestRows = Object.values(requests).map((item) => ({
      owner_id: ownerId,
      food_id: item.food_id,
      quantity: item.quantity,
      in_cart: false,
    }))
    const rows = [...cartRows, ...requestRows]

    const { data: existingRows, error: selectError } = await supabase
      .from('shopping_list')
      .select('id, food_id')
      .eq('owner_id', ownerId)
    if (selectError) return selectError

    if (rows.length > 0) {
      const { error: upsertError } = await supabase
        .from('shopping_list')
        .upsert(rows, { onConflict: 'owner_id,food_id' })
      if (upsertError) return upsertError
    }

    const keepIds = new Set(rows.map((row) => row.food_id))
    const staleIds = (existingRows || [])
      .filter((row) => !keepIds.has(row.food_id))
      .map((row) => row.id)

    if (staleIds.length > 0) {
      const { error: deleteError } = await supabase
        .from('shopping_list')
        .delete()
        .in('id', staleIds)
      if (deleteError) return deleteError
    }

    return null
  }

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
    const requestMap = {}
    const targetMap = {}
    for (const c of cartRes.data || []) {
      if (c.in_cart) cMap[c.food_id] = c
      else {
        requestMap[c.food_id] = c
        targetMap[c.food_id] = c.quantity
      }
    }
    setCart(cMap)
    setRequests(requestMap)
    setRequestTargets(targetMap)
    setOwnerName(ownerRes.data?.username || '')
    const invMap = {}
    for (const inv of inventoryRes.data || []) invMap[inv.food_id] = inv.quantity
    setInventory(invMap)
    setLoading(false)
  }

  async function addToCart(food) {
    const existingRequest = requests[food.id]
    if (existingRequest) {
      setCart((prev) => ({
        ...prev,
        [food.id]: {
          ...existingRequest,
          in_cart: true,
        },
      }))
      setRequests((prev) => {
        const next = { ...prev }
        delete next[food.id]
        return next
      })
      setRequestTargets((prev) => ({ ...prev, [food.id]: existingRequest.quantity }))
      return
    }

    setCart((prev) => ({
      ...prev,
      [food.id]: {
        owner_id: ownerId,
        food_id: food.id,
        in_cart: true,
        quantity: 1,
      },
    }))
  }

  function changeQty(food, delta) {
    const existing = cart[food.id]
    if (!existing) return
    const targetQty = requestTargets[food.id] || 0
    const newQty = existing.quantity + delta
    if (newQty <= 0) {
      if (targetQty > 0) {
        setCart((prev) => { const n = { ...prev }; delete n[food.id]; return n })
        setRequests((prev) => ({
          ...prev,
          [food.id]: {
            ...existing,
            in_cart: false,
            quantity: targetQty,
          },
        }))
      } else {
        setCart((prev) => { const n = { ...prev }; delete n[food.id]; return n })
      }
    } else {
      setCart((prev) => ({
        ...prev,
        [food.id]: {
          ...existing,
          quantity: newQty,
        },
      }))
    }
  }

  async function finishShopping() {
    if (Object.keys(cart).length === 0) return
    setFinishing(true)

    const syncError = await syncShoppingListState()
    if (syncError) {
      setFinishing(false)
      notifyError(syncError.message)
      return
    }

    const { data, error } = await supabase.rpc('finish_shopping', { p_shopper_id: session.user_id })
    setFinishing(false)
    if (error) { notifyError(error.message); return }
    notifySuccess(`נרשמו ${data} פריטים במלאי 🎉`)
    setShowFinishConfirm(false)
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
    const foodCategory = getFoodCategory(f)
    if (categoryFilter !== ALL_CATEGORY_KEY && foodCategory !== categoryFilter) continue
    const rating = ratings[f.id]
    grouped[categoryFor(rating)].push({ ...f, rating, foodCategory })
  }
  for (const c of ['green', 'yellow', 'orange']) grouped[c].sort((a, b) => b.rating - a.rating)

  const cartItems = Object.values(cart)
  const cartCount = cartItems.reduce((s, i) => s + i.quantity, 0)
  const requestItems = Object.values(requests)
  const remainingFromCart = cartItems
    .map((item) => {
      const targetQty = requestTargets[item.food_id] || 0
      const remainingQty = Math.max(targetQty - item.quantity, 0)
      return remainingQty > 0 ? { food_id: item.food_id, quantity: remainingQty } : null
    })
    .filter(Boolean)
  const requestBannerItems = [
    ...requestItems.map((item) => ({ ...item, canAddToCart: true })),
    ...remainingFromCart.map((item) => ({ ...item, canAddToCart: false })),
  ]
  const foodById = foods.reduce((map, item) => {
    map[item.id] = item
    return map
  }, {})

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
          <div className="shopper-sticky-stack">
            {requestBannerItems.length > 0 && (
              <div className="shopper-request-banner">
                <div className="shopper-request-title">בקשות קנייה מ{ownerName || 'הבעלים'}</div>
                <div className="shopper-request-list">
                  {requestBannerItems.map((request) => (
                    <div key={`${request.food_id}-${request.canAddToCart ? 'pending' : 'remaining'}`} className="shopper-request-item">
                      <div className="shopper-request-thumb">
                        {foodById[request.food_id]?.picture_url ? (
                          <img src={foodById[request.food_id].picture_url} alt="" onError={(e) => (e.target.style.display = 'none')} />
                        ) : (
                          <div className="placeholder">{foodById[request.food_id]?.name?.[0] || '?'}</div>
                        )}
                      </div>
                      <div className="shopper-request-info">
                        <strong>{foodById[request.food_id]?.name || 'מוצר'} × {request.quantity}</strong>
                        {foodById[request.food_id]?.unit_qty && <small>{foodById[request.food_id].unit_qty}</small>}
                      </div>
                      {request.canAddToCart ? (
                        <button onClick={() => addToCart({ id: request.food_id })}>הוסף לעגלה</button>
                      ) : (
                        <small className="request-remaining-note">נותרו לבקשה</small>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

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
          </div>

          <div className="category-filter-bar">
            <button
              className={categoryFilter === ALL_CATEGORY_KEY ? 'active' : ''}
              onClick={() => setCategoryFilter(ALL_CATEGORY_KEY)}
            >
              {ALL_CATEGORY_LABEL}
            </button>
            {CATEGORY_FILTERS.map((category) => (
              <button
                key={category.key}
                className={categoryFilter === category.key ? 'active' : ''}
                onClick={() => setCategoryFilter(category.key)}
              >
                {category.label}
              </button>
            ))}
          </div>

          <div className="view-mode-toggle">
            <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}>רשימה</button>
            <button className={viewMode === 'table' ? 'active' : ''} onClick={() => setViewMode('table')}>טבלה</button>
          </div>

          {['green', 'yellow', 'orange', 'unrated'].map((cat) => (
            grouped[cat].length > 0 && (
              <section key={cat}>
                <h2 style={{ color: colors[cat] }}>
                  {labels[cat]} <span className="count">({grouped[cat].length})</span>
                </h2>
                <div className={`food-list ${viewMode === 'table' ? 'table-view' : ''}`}>
                  {grouped[cat].map((food) => (
                    <ShopFoodCard
                      key={food.id}
                      food={food}
                      inCart={!!cart[food.id]}
                      quantity={cart[food.id]?.quantity}
                      requestRemaining={Math.max((requestTargets[food.id] || 0) - (cart[food.id]?.quantity || 0), 0)}
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

          {(q || categoryFilter !== ALL_CATEGORY_KEY) && Object.values(grouped).every(g => g.length === 0) && (
            <p className="muted">לא נמצאו מוצרים עבור "{search}"</p>
          )}

          {cartCount > 0 && (
            <div className="cart-bar">
              <div className="cart-info">
                <strong>{cartCount} פריטים</strong>
              </div>
              <button className="finish-btn" onClick={() => setShowFinishConfirm(true)} disabled={finishing}>
                {finishing ? 'טוען...' : 'סיים קניות'}
              </button>
            </div>
          )}

          <ConfirmDialog
            open={showFinishConfirm}
            title="סיום קניות"
            message="לסיים את הקניות ולעדכן את המלאי?"
            confirmText="סיים קניות"
            confirmClassName="btn-primary"
            onConfirm={finishShopping}
            onCancel={() => setShowFinishConfirm(false)}
            loading={finishing}
          />
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

function ShopFoodCard({ food, inCart, quantity, requestRemaining, inventoryQty, onAdd, onInc, onDec }) {
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
          {inCart && requestRemaining > 0 && <span className="request-remaining-note"> · נותרו {requestRemaining} מהבקשה</span>}
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