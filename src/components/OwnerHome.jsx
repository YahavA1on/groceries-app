import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getTheme, toggleTheme } from '../lib/theme'
import RatingPicker from './RatingPicker'
import InventoryView from './InventoryView'
import FoodEditPanel from './FoodEditPanel'

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
  const [tab, setTab] = useState('foods')
  const [foods, setFoods] = useState([])
  const [ratings, setRatings] = useState({})
  const [loading, setLoading] = useState(true)
  const [picking, setPicking] = useState(null)
  const [editingMode, setEditingMode] = useState(false)
  const [editingPanel, setEditingPanel] = useState(null)
  const [theme, setTheme] = useState(getTheme())

  useEffect(() => { loadData() }, [])

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
    setLoading(false)
  }

  async function setRating(foodId, rating) {
    const { error } = await supabase.from('ratings').upsert(
      { owner_id: session.user_id, food_id: foodId, rating, updated_at: new Date().toISOString() },
      { onConflict: 'owner_id,food_id' }
    )
    if (error) { alert(error.message); return }
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

  const grouped = { green: [], yellow: [], orange: [], unrated: [] }
  for (const f of foods) {
    const rating = ratings[f.id]
    grouped[categoryFor(rating)].push({ ...f, rating })
  }
  for (const c of ['green', 'yellow', 'orange']) grouped[c].sort((a, b) => b.rating - a.rating)

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
          מוצרים
        </button>
        <button className={tab === 'inventory' ? 'active' : ''} onClick={() => setTab('inventory')}>
          מלאי
        </button>
      </nav>

      {tab === 'foods' && (
        loading ? <div className="loading">טוען...</div> : (
          <>
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
                  <div className="food-list">
                    {grouped[cat].map((food) => (
                      <FoodCard
                        key={food.id}
                        food={food}
                        onClick={() => setPicking(food)}
                        onEdit={() => setEditingPanel(food)}
                        isEditMode={editingMode}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))}
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
          </>
        )
      )}

      {tab === 'inventory' && <InventoryView session={session} />}
    </div>
  )
}

function FoodCard({ food, onClick, onEdit, isEditMode }) {
  return (
    <div className="food-card-wrapper">
      <div className="food-card-content" onClick={onClick}>
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
        <div className="food-rating">
          {food.rating ? <span className="rating-badge">★ {food.rating}</span> : <span className="rate-cta">דרג</span>}
        </div>
      </div>
      {isEditMode && (
        <button className="food-card-edit" onClick={(e) => { e.stopPropagation(); onEdit(); }} title="ערוך מוצר">
          ✏️
        </button>
      )}
    </div>
  )
}