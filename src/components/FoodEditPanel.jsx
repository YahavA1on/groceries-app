import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function FoodEditPanel({ food, onClose, onSave, onDelete }) {
  const [name, setName] = useState(food?.name || '')
  const [imageUrl, setImageUrl] = useState(food?.picture_url || '')
  const [manufacturer, setManufacturer] = useState(food?.manufacturer || '')
  const [unitQty, setUnitQty] = useState(food?.unit_qty || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isNew = !food?.id
  const isValid = name.trim().length > 0

  function handleCancel() {
    if (!isNew && window.confirm(`בטל עריכה של "${food.name}"?`)) {
      onClose()
    } else if (isNew) {
      onClose()
    }
  }

  async function handleDelete() {
    if (!window.confirm(`האם אתה בטוח שברצונך למחוק את "${food.name}"?`)) return

    setSaving(true)
    try {
      const { error: err } = await supabase
        .from('foods')
        .delete()
        .eq('id', food.id)

      if (err) throw err
      // Call parent's onDelete callback, then close
      onDelete?.()
      onClose()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  async function handleSave() {
    setError('')
    setSaving(true)

    try {
      const data = {
        name: name.trim(),
        picture_url: imageUrl.trim() || null,
        manufacturer: manufacturer.trim() || null,
        unit_qty: unitQty.trim() || null,
      }

      if (isNew) {
        // Generate a UUID for external_id when creating new food
        const externalId = `food_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        
        const { data: inserted, error: err } = await supabase
          .from('foods')
          .insert([{ ...data, external_id: externalId }])
          .select()

        if (err) throw err
        onSave(inserted[0])
      } else {
        const { error: err } = await supabase
          .from('foods')
          .update(data)
          .eq('id', food.id)

        if (err) throw err
        onSave({ ...food, ...data })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal food-edit-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isNew ? '➕ הוסף מוצר חדש' : '✏️ ערוך מוצר'}</h3>

        {error && <div className="error-message">{error}</div>}

        <div className="form-group">
          <label htmlFor="name">שם המוצר *</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., בשר טחון"
            disabled={saving}
          />
        </div>

        <div className="form-group">
          <label htmlFor="imageUrl">URL תמונה</label>
          <input
            id="imageUrl"
            type="url"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://example.com/image.jpg"
            disabled={saving}
          />
          {imageUrl && (
            <div className="image-preview">
              <img
                src={imageUrl}
                alt="preview"
                onError={(e) => {
                  e.target.style.display = 'none'
                }}
              />
            </div>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="manufacturer">יצרן</label>
          <input
            id="manufacturer"
            type="text"
            value={manufacturer}
            onChange={(e) => setManufacturer(e.target.value)}
            placeholder="e.g., פלנט"
            disabled={saving}
          />
        </div>

        <div className="form-group">
          <label htmlFor="unitQty">כמות ליחידה</label>
          <input
            id="unitQty"
            type="text"
            value={unitQty}
            onChange={(e) => setUnitQty(e.target.value)}
            placeholder="e.g., 500g"
            disabled={saving}
          />
        </div>

        <div className="form-actions">
          <button className="btn-primary" onClick={handleSave} disabled={!isValid || saving}>
            {saving ? 'שומר...' : '💾 שמור'}
          </button>
          <button className="btn-secondary" onClick={handleCancel} disabled={saving}>
            ביטול
          </button>
          {!isNew && (
            <button className="btn-danger" onClick={handleDelete} disabled={saving}>
              🗑️ מחק
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
