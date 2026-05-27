import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getTheme, toggleTheme } from '../lib/theme'
import RatingPicker from './RatingPicker'
import InventoryView from './InventoryView'
import FoodEditPanel from './FoodEditPanel'
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
  green:   '💚 אוהב',
  yellow:  '💛 בסדר',
  orange:  '🧡 לא אוהב',
  unrated: '⚪ עוד לא דירגתי',
}

export default function OwnerHome({ session, onLogout }) {
  const { notifySuccess, notifyError } = useNotifications()
  const [tab, setTab] = useState('foods')
  const [foods, setFoods] = useState([])
  const [ratings, setRatings] = useState({})
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [picking, setPicking] = useState(null)
  const [editingMode, setEditingMode] = useState(false)
  const [editingPanel, setEditingPanel] = useState(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORY_KEY)
  const [requestDraft, setRequestDraft] = useState({})
  const [sendingRequest, setSendingRequest] = useState(false)
  const [viewMode, setViewMode] = useState('list')
  const [editingRequest, setEditingRequest] = useState(null)
  const [editingRequestQty, setEditingRequestQty] = useState(1)
  const [savingRequestEdit, setSavingRequestEdit] = useState(false)
  const [theme, setTheme] = useState(getTheme())

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    const channel = supabase
      .channel(`owner-requests-${session.user_id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shopping_list', filter: `owner_id=eq.${session.user_id}` },
        () => fetchPendingRequests()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [session.user_id])

  async function fetchPendingRequests() {
    const { data } = await supabase
      .from('shopping_list')
      .select('id, food_id, quantity, in_cart')
      .eq('owner_id', session.user_id)
      .eq('in_cart', false)

    setRequests(data || [])
  }

  async function loadData() {
    setLoading(true)
    const [foodsRes, ratingsRes] = await Promise.all([
      supabase.from('foods').select('id, name, manufacturer, price, picture_url, unit_qty').order('name'),
      supabase.from('ratings').select('food_id, rating').eq('owner_id', session.user_id),
    ])
    setFoods(foodsRes.data || [])
    const map = {}
    for (const r of ratingsRes.data || []) map[r.food_id] = r.rating
    setRatings(map)
    await fetchPendingRequests()
    setLoading(false)
  }

  async function setRating(foodId, rating) {
    const { error } = await supabase.from('ratings').upsert(
      { owner_id: session.user_id, food_id: foodId, rating, updated_at: new Date().toISOString() },
      { onConflict: 'owner_id,food_id' }
    )
    if (error) { notifyError(error.message); return }
    setRatings((prev) => ({ ...prev, [foodId]: rating }))
    setPicking(null)
  }

  const handleThemeToggle = () => {
    const newTheme = toggleTheme()
    setTheme(newTheme)
  }

  async function handleSaveFood(savedFood) {
    if (editingPanel?.id) {
      // Update existing
      setFoods(foods.map(f => f.id === savedFood.id ? savedFood : f))
    } else {
      // Add new
      setFoods([...foods, savedFood])
    }
    setEditingPanel(null)
  }

  function handleDeletedFood(deletedId) {
    setFoods(foods.filter(f => f.id !== deletedId))
    setRatings(prev => {
      const updated = { ...prev }
      delete updated[deletedId]
      return updated
    })
    setEditingPanel(null)
  }

  function addToDraft(foodId) {
    setRequestDraft((prev) => ({
      ...prev,
      [foodId]: (prev[foodId] || 0) + 1,
    }))
  }

  function changeDraftQty(foodId, delta) {
    setRequestDraft((prev) => {
      const current = prev[foodId] || 0
      const nextQty = current + delta
      if (nextQty <= 0) {
        const updated = { ...prev }
        delete updated[foodId]
        return updated
      }
      return { ...prev, [foodId]: nextQty }
    })
  }

  async function sendRequest() {
    const entries = Object.entries(requestDraft)
    if (entries.length === 0) return

    setSendingRequest(true)
    const payload = entries.map(([foodId, quantity]) => ({
      owner_id: session.user_id,
      food_id: foodId,
      quantity,
      in_cart: false,
    }))

    const { error } = await supabase
      .from('shopping_list')
      .upsert(payload, { onConflict: 'owner_id,food_id' })

    setSendingRequest(false)
    if (error) {
      notifyError(error.message)
      return
    }

    setRequestDraft({})
    await loadData()
    notifySuccess('הבקשה נשלחה לקונה')
  }

  async function cancelRequest(requestId) {
    const { error } = await supabase.from('shopping_list').delete().eq('id', requestId)
    if (error) {
      notifyError(error.message)
      return
    }
    setRequests((prev) => prev.filter((request) => request.id !== requestId))
    notifySuccess('הבקשה הוסרה')
  }

  function openRequestEditor(request) {
    setEditingRequest(request)
    setEditingRequestQty(request.quantity)
  }

  async function saveRequestQuantity() {
    if (!editingRequest) return
    if (editingRequestQty <= 0) {
      await cancelRequest(editingRequest.id)
      setEditingRequest(null)
      return
    }

    setSavingRequestEdit(true)
    const { error } = await supabase
      .from('shopping_list')
      .update({ quantity: editingRequestQty })
      .eq('id', editingRequest.id)
    setSavingRequestEdit(false)

    if (error) {
      notifyError(error.message)
      return
    }

    setRequests((prev) => prev.map((request) =>
      request.id === editingRequest.id ? { ...request, quantity: editingRequestQty } : request
    ))
    setEditingRequest(null)
  }

  const q = search.toLowerCase().trim()
  const grouped = { green: [], yellow: [], orange: [], unrated: [] }
  for (const f of foods) {
    if (q && !f.name.toLowerCase().includes(q) && !(f.manufacturer && f.manufacturer.toLowerCase().includes(q))) continue
    const foodCategory = getFoodCategory(f)
    if (categoryFilter !== ALL_CATEGORY_KEY && foodCategory !== categoryFilter) continue
    const rating = ratings[f.id]
    grouped[categoryFor(rating)].push({ ...f, rating, foodCategory })
  }
  for (const c of ['green', 'yellow', 'orange']) grouped[c].sort((a, b) => b.rating - a.rating)
  const requestCount = Object.values(requestDraft).reduce((sum, qty) => sum + qty, 0)

  return (
    <div className="owner-home">
      <header>
        <div style={{ textAlign: 'right', flex: 1 }}>
          <h1>שלום {session.username}</h1>
        </div>
        <div className="header-actions">
          {tab === 'foods' && (
            <button 
              className={`edit-toggle ${editingMode ? 'active' : ''}`}
              onClick={() => setEditingMode(!editingMode)}
              title="מצב עריכה"
            >
              ✏️
            </button>
          )}
          <button className="theme-toggle" onClick={handleThemeToggle} title="החלף מצב">
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button onClick={onLogout}>יציאה</button>
        </div>
      </header>

      <nav className="tab-nav">
        <button className={tab === 'foods' ? 'active' : ''} onClick={() => setTab('foods')}>
          קניות
        </button>
        <button className={tab === 'inventory' ? 'active' : ''} onClick={() => setTab('inventory')}>
          מלאי
        </button>
        <button className={tab === 'requests' ? 'active' : ''} onClick={() => setTab('requests')}>
          בקשות {requests.length > 0 ? `(${requests.length})` : ''}
        </button>
      </nav>

      {tab === 'foods' && (
        loading ? <div className="loading">טוען...</div> : (
          <>
            <div className="search-container">
              <input
                type="search"
                placeholder="חיפוש מוצר..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && <button className="clear-search" onClick={() => setSearch('')}>✕</button>}
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

            {editingMode && (
              <div className="edit-mode-toolbar">
                <span>מצב עריכה פעיל</span>
                <button className="btn-add-food" onClick={() => setEditingPanel({})}>➕ מוצר חדש</button>
              </div>
            )}
            {['green', 'yellow', 'orange', 'unrated'].map((cat) => (
              <section key={cat}>
                <h2 style={{ color: colors[cat] }}>
                  {labels[cat]} <span className="count">({grouped[cat].length})</span>
                </h2>
                {grouped[cat].length === 0 ? (
                  <p className="muted">אין פריטים</p>
                ) : (
                  <div className={`food-list ${viewMode === 'table' ? 'table-view' : ''}`}>
                    {grouped[cat].map((food) => (
                      <FoodCard
                        key={food.id}
                        food={food}
                        onOpenRating={() => setPicking(food)}
                        onEdit={() => setEditingPanel(food)}
                        requestQty={requestDraft[food.id] || 0}
                        onAddRequest={() => addToDraft(food.id)}
                        onIncRequest={() => changeDraftQty(food.id, +1)}
                        onDecRequest={() => changeDraftQty(food.id, -1)}
                        requestsEnabled={!editingMode}
                        isEditMode={editingMode}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))}
            {(q || categoryFilter !== ALL_CATEGORY_KEY) && Object.values(grouped).every((items) => items.length === 0) && (
              <p className="muted">לא נמצאו מוצרים עבור "{search}"</p>
            )}
            {picking && (
              <RatingPicker
                food={picking}
                current={ratings[picking.id]}
                onSelect={(r) => setRating(picking.id, r)}
                onClose={() => setPicking(null)}
              />
            )}
            {editingPanel !== null && (
              <FoodEditPanel
                food={editingPanel}
                onClose={() => setEditingPanel(null)}
                onSave={handleSaveFood}
                onDelete={() => editingPanel?.id && handleDeletedFood(editingPanel.id)}
              />
            )}

            {requestCount > 0 && (
              <div className="request-send-bar">
                <div className="request-send-info">
                  <strong>{requestCount} מוצרים לבקשה</strong>
                </div>
                <button className="request-send-btn" onClick={sendRequest} disabled={sendingRequest}>
                  {sendingRequest ? 'שולח...' : 'שלח בקשה'}
                </button>
              </div>
            )}
          </>
        )
      )}

      {tab === 'inventory' && <InventoryView session={session} />}

      {tab === 'requests' && (
        loading ? <div className="loading">טוען...</div> : (
          <div className="owner-requests-tab">
            {requests.length === 0 ? (
              <p className="muted">אין בקשות פעילות כרגע</p>
            ) : (
              <div className="food-list">
                {requests.map((request) => {
                  const food = foods.find((item) => item.id === request.food_id)
                  return (
                    <div key={request.id} className="owner-request-item">
                      <div className="owner-request-thumb">
                        {food?.picture_url ? (
                          <img src={food.picture_url} alt="" onError={(e) => (e.target.style.display = 'none')} />
                        ) : (
                          <div className="placeholder">{food?.name?.[0] || '?'}</div>
                        )}
                      </div>
                      <div className="owner-request-info">
                        <strong>{food?.name || 'מוצר שנמחק'}</strong>
                        <small>
                          כמות מבוקשת: {request.quantity}
                          {food?.unit_qty ? ` · יחידה: ${food.unit_qty}` : ''}
                        </small>
                      </div>
                      <button className="owner-cancel-request" onClick={() => openRequestEditor(request)}>
                        בטל בקשה
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      )}

      {editingRequest && (
        <div className="modal-backdrop" onClick={() => !savingRequestEdit && setEditingRequest(null)}>
          <div className="modal request-adjust-modal" onClick={(e) => e.stopPropagation()}>
            <h3>עדכון כמות בקשה</h3>
            <div className="request-adjust-qty">
              <button onClick={() => setEditingRequestQty((q) => Math.max(0, q - 1))} disabled={savingRequestEdit}>−</button>
              <span>{editingRequestQty}</span>
              <button onClick={() => setEditingRequestQty((q) => q + 1)} disabled={savingRequestEdit}>+</button>
            </div>
            <div className="request-adjust-actions">
              <button className="btn-primary" onClick={saveRequestQuantity} disabled={savingRequestEdit}>
                {savingRequestEdit ? 'שומר...' : 'שמור כמות'}
              </button>
              <button className="btn-danger" onClick={async () => { await cancelRequest(editingRequest.id); setEditingRequest(null) }} disabled={savingRequestEdit}>
                מחק בקשה
              </button>
            </div>
            <button className="cancel" onClick={() => setEditingRequest(null)} disabled={savingRequestEdit}>סגור</button>
          </div>
        </div>
      )}
    </div>
  )
}

function FoodCard({
  food,
  onOpenRating,
  onEdit,
  requestQty,
  onAddRequest,
  onIncRequest,
  onDecRequest,
  requestsEnabled,
  isEditMode,
}) {
  const hasDraftRequest = requestQty > 0

  return (
    <div className="food-card-wrapper">
      <div className="food-card-content" onClick={requestsEnabled ? onAddRequest : undefined}>
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
          {food.unit_qty && <div className="food-meta">{food.unit_qty}</div>}
        </div>

        {requestsEnabled && (
          <div className="owner-request-controls" onClick={(e) => e.stopPropagation()}>
            {!hasDraftRequest && (
              <button className="owner-add-request" onClick={onAddRequest} title="הוסף לבקשה">
                🛒+
              </button>
            )}
            {hasDraftRequest && (
              <div className="qty-controls">
                <button onClick={onDecRequest}>−</button>
                <span className="qty">{requestQty}</span>
                <button onClick={onIncRequest}>+</button>
              </div>
            )}
          </div>
        )}

        <button className="owner-rating-button" onClick={(e) => { e.stopPropagation(); onOpenRating(); }}>
          {food.rating ? <span className="rating-badge">★ {food.rating}</span> : <span className="rate-cta">דרג</span>}
        </button>
      </div>
      {isEditMode && (
        <button className="food-card-edit" onClick={(e) => { e.stopPropagation(); onEdit(); }} title="ערוך מוצר">
          ✏️
        </button>
      )}
    </div>
  )
}