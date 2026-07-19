import { useCallback, useEffect, useMemo, useState } from 'react'
import FoodFilterBar from './FoodFilterBar'
import TopNotice from './TopNotice'
import { useCart } from '../hooks/useCart'
import { DEFAULT_MANUFACTURER, addInventoryQuantities, addShoppingListItems, applyRelatedRatings, deleteFamilyRating, fetchFoodsWithOptionalCategory, fetchRatingsByOwner, saveFamilyRating } from '../lib/foodData'
import { ALL_CATEGORIES, buildCategoryOptions, getFoodCategory, groupFoodsByRank, groupFoodsByRatingMood, groupItemsByCategory, matchesFoodFilters, rankMetaForRating, ratingColorClass, visibleUniqueFoods } from '../lib/foodFilters'
import { isRateableFood } from '../lib/productRules'
import { supabase } from '../lib/supabase'

export default function CatalogPage({ onSubmitted, session }) {
  const { addProduct, changeQuantity, clearCart, count, items, lineItems, removeProduct } = useCart()
  const [foods, setFoods] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState(ALL_CATEGORIES)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [ratings, setRatings] = useState({})
  const [ratingFoodId, setRatingFoodId] = useState(null)
  const [confirmAction, setConfirmAction] = useState(null)
  const [editingFood, setEditingFood] = useState(null)
  const [editingValues, setEditingValues] = useState(null)
  const [editingBusy, setEditingBusy] = useState(false)
  const [confirmEditClose, setConfirmEditClose] = useState(false)
  const [addingFood, setAddingFood] = useState(false)
  const [newFoodValues, setNewFoodValues] = useState(() => emptyFoodValues())

  const canManageItems = session.member_role === 'manager' || session.is_admin

  const loadFoods = useCallback(async () => {
    setLoading(true)
    setError('')

    const [foodsResult, ratingsResult] = await Promise.all([
      fetchFoodsWithOptionalCategory(),
      fetchRatingsByOwner(session),
    ])

    const loadedFoods = foodsResult.data || []

    if (foodsResult.error) {
      setError(foodsResult.error.message)
      setFoods([])
    } else {
      setFoods(loadedFoods)
    }

    if (!ratingsResult.error) setRatings(applyRelatedRatings(loadedFoods, ratingsResult.data, ratingsResult.rows))

    setLoading(false)
  }, [session])

  useEffect(() => {
    const timeoutId = setTimeout(loadFoods, 0)
    return () => clearTimeout(timeoutId)
  }, [loadFoods])

  const foodById = useMemo(() => {
    const map = new Map()
    for (const food of foods) map.set(food.id, food)
    return map
  }, [foods])

  const catalogFoods = useMemo(() => sortFoodsByName(visibleUniqueFoods(foods)), [foods])
  const categoryOptions = useMemo(() => buildCategoryOptions(catalogFoods), [catalogFoods])
  const filteredFoods = useMemo(
    () => catalogFoods.filter((food) => matchesFoodFilters(food, search, category)),
    [catalogFoods, category, search]
  )

  const groupedFoods = useMemo(
    () => (canManageItems ? groupFoodsByRank(filteredFoods, ratings) : groupFoodsByRatingMood(filteredFoods, ratings)),
    [canManageItems, filteredFoods, ratings]
  )

  const cartLines = useMemo(
    () =>
      lineItems
        .map((item) => ({ ...item, food: foodById.get(item.productId) }))
        .filter((item) => item.food),
    [lineItems, foodById]
  )

  async function saveShoppingList(inCart) {
    if (cartLines.length === 0 || !session.family_id) return

    setSubmitting(true)
    setError('')
    setSuccess('')

    if (inCart) {
      try {
        await addInventoryQuantities(
          session,
          cartLines.map((item) => ({
            item: { quantity: item.quantity },
            food: { id: item.productId },
          }))
        )
      } catch (inventoryError) {
        setSubmitting(false)
        setError(inventoryError.message)
        return
      }

      setSubmitting(false)
      clearCart()
      setSuccess('המלאי עודכן.')
      return
    }

    const rows = cartLines.map((item) => ({
      food_id: item.productId,
      quantity: item.quantity,
    }))

    const { error: upsertError } = await addShoppingListItems(session, rows)

    setSubmitting(false)

    if (upsertError) {
      setError(upsertError.message)
      return
    }

    clearCart()
    setSuccess('המוצרים נוספו לרשימת הקניות.')
    onSubmitted?.()
  }

  function requestSave(inCart) {
    setConfirmAction({
      inCart,
      title: inCart ? 'שמירה במלאי' : 'הוספה לרשימה',
      message: inCart
        ? `לשמור ${count} פריטים במלאי?`
        : `להוסיף ${count} פריטים לרשימת הקניות?`,
      confirmText: inCart ? 'כן, שמירה במלאי' : 'כן, הוסף לרשימה',
    })
  }

  async function confirmSave() {
    if (!confirmAction) return
    const nextAction = confirmAction
    setConfirmAction(null)
    await saveShoppingList(nextAction.inCart)
  }

  async function saveRating(foodId, rating) {
    if (!isRateableFood(foodById.get(foodId))) return false
    setRatingFoodId(foodId)
    setError('')

    const { error: ratingError } = await saveFamilyRating(session, foodId, rating)

    setRatingFoodId(null)

    if (ratingError) {
      setError(ratingError.message)
      return false
    }

    setRatings((current) => ({ ...current, [foodId]: rating }))
    return true
  }

  function openEditor(food) {
    setEditingFood(food)
    setEditingValues(buildEditValues(food, ratings[food.id]))
    setConfirmEditClose(false)
  }

  function closeEditor() {
    setEditingFood(null)
    setEditingValues(null)
    setConfirmEditClose(false)
  }

  function requestCloseEditor() {
    if (editingBusy) return
    if (hasEditChanges(editingFood, editingValues, ratings[editingFood?.id])) {
      setConfirmEditClose(true)
      return
    }
    closeEditor()
  }

  async function saveFoodEdit() {
    if (!editingFood || !editingValues) return

    const payload = cleanFoodValues(editingValues)
    if (!allFoodFieldsPresent(payload)) {
      setError('כל שדות המוצר הם שדות חובה.')
      return
    }

    setEditingBusy(true)
    setError('')
    setSuccess('')

    const { data: updatedFood, error: updateError } = await supabase.rpc('update_catalog_food', {
      p_session_token: session.token,
      p_food_id: editingFood.id,
      p_name: payload.name,
      p_manufacturer: payload.manufacturer,
      p_category: payload.category,
      p_unit_qty: payload.unit_qty,
      p_picture_url: payload.picture_url,
    })

    if (updateError) {
      setEditingBusy(false)
      setError(updateError.message)
      return
    }

    if (!isRateableFood({ ...editingFood, ...payload }) || editingValues.rating === '') {
      const { error: deleteRatingError } = await deleteFamilyRating(session, editingFood.id)

      if (deleteRatingError) {
        setEditingBusy(false)
        setError(deleteRatingError.message)
        return
      }

      setRatings((current) => {
        const next = { ...current }
        delete next[editingFood.id]
        return next
      })
    } else {
      const saved = await saveRating(editingFood.id, Number(editingValues.rating))
      if (!saved) {
        setEditingBusy(false)
        return
      }
    }

    setFoods((current) =>
      current.map((food) => (food.id === editingFood.id ? { ...food, ...updatedFood } : food))
    )
    setEditingBusy(false)
    closeEditor()
    setSuccess('המוצר עודכן.')
  }

  async function deleteFood() {
    if (!editingFood) return
    if (!window.confirm(`למחוק את ${editingFood.name}?`)) return

    setEditingBusy(true)
    setError('')
    setSuccess('')

    const { error: deleteError } = await supabase.rpc('delete_catalog_food', {
      p_session_token: session.token,
      p_food_id: editingFood.id,
    })

    if (deleteError) {
      setEditingBusy(false)
      setError(deleteError.message)
      return
    }

    removeProduct(editingFood.id)
    setFoods((current) => current.filter((food) => food.id !== editingFood.id))
    setRatings((current) => {
      const next = { ...current }
      delete next[editingFood.id]
      return next
    })
    setEditingBusy(false)
    closeEditor()
    setSuccess('המוצר נמחק.')
  }

  async function addManualFood() {
    const payload = cleanFoodValues(newFoodValues)
    if (!allFoodFieldsPresent(payload)) {
      setError('כל שדות המוצר הם שדות חובה.')
      return
    }

    setEditingBusy(true)
    setError('')
    const { data, error: addError } = await supabase.rpc('add_catalog_food', {
      p_session_token: session.token,
      p_name: payload.name,
      p_manufacturer: payload.manufacturer,
      p_category: payload.category,
      p_unit_qty: payload.unit_qty,
      p_picture_url: payload.picture_url,
    })
    setEditingBusy(false)

    if (addError) {
      setError(addError.code === '23505' ? 'המוצר כבר קיים.' : addError.message)
      return
    }

    setFoods((current) => sortFoodsByName([...current, data]))
    setNewFoodValues(emptyFoodValues())
    setAddingFood(false)
    setSuccess('המוצר נוסף למאגר.')
  }

  return (
    <section className="space-y-4">
      <TopNotice
        notice={error ? { tone: 'error', text: error } : success ? { tone: 'success', text: success } : null}
        onDismiss={() => {
          setError('')
          setSuccess('')
        }}
      />

      {count > 0 ? (
        <div className="sticky top-[73px] z-20 rounded-2xl border border-rose-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-rose-700 dark:text-cyan-300">עגלה מוצמדת</p>
              <p className="font-black">{count} פריטים</p>
            </div>
            <button
              className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-black text-slate-700 dark:bg-slate-800 dark:text-slate-200"
              onClick={clearCart}
              type="button"
            >
              ניקוי
            </button>
          </div>

          <div className="mb-3 max-h-52 overflow-auto pe-1">
            {cartLines.map((item) => (
              <div className="flex items-center gap-2 border-t border-rose-50 py-2 text-sm first:border-t-0 dark:border-slate-800" key={item.productId}>
                <span className="min-w-0 flex-1 truncate font-bold">{item.food.name}</span>
                <div className="flex items-center rounded-xl border border-rose-200 dark:border-slate-700">
                  <button className="h-9 w-9 text-lg font-black" onClick={() => changeQuantity(item.productId, -1)} type="button">
                    -
                  </button>
                  <span className="min-w-7 text-center font-black">{item.quantity}</span>
                  <button className="h-9 w-9 text-lg font-black" onClick={() => changeQuantity(item.productId, 1)} type="button">
                    +
                  </button>
                </div>
                <button
                  aria-label={`הסרת ${item.food.name}`}
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-base font-black text-rose-700 dark:bg-rose-500/10 dark:text-rose-200"
                  onClick={() => removeProduct(item.productId)}
                  title="הסרה"
                  type="button"
                >
                  🗑
                </button>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              className="rounded-xl bg-cyan-500 px-3 py-3 font-black text-slate-950 disabled:opacity-60"
              disabled={submitting}
              onClick={() => requestSave(true)}
              type="button"
            >
              {submitting ? 'שומר...' : 'שמירה במלאי'}
            </button>
            <button
              className="rounded-xl bg-rose-600 px-3 py-3 font-black text-white disabled:opacity-60"
              disabled={submitting}
              onClick={() => requestSave(false)}
              type="button"
            >
              {submitting ? 'מוסיף...' : 'הוסף לרשימה'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black">הוספת מוצרים</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">בחרו מוצרים והוסיפו אותם לרשימת הקניות.</p>
          </div>
          {canManageItems ? (
            <button className="shrink-0 rounded-xl bg-cyan-500 px-3 py-3 text-sm font-black text-slate-950" onClick={() => setAddingFood(true)} type="button">
              מוצר חדש
            </button>
          ) : null}
        </div>
      </div>

      <FoodFilterBar
        category={category}
        categoryOptions={categoryOptions}
        onCategoryChange={setCategory}
        onSearchChange={setSearch}
        search={search}
      />

      {loading ? (
        <EmptyState text="טוען מוצרים..." />
      ) : filteredFoods.length === 0 ? (
        <EmptyState text="לא נמצאו מוצרים." />
      ) : (
        <div className="space-y-5">
          {groupedFoods.map((group) => (
            <section className="space-y-3" key={group.key}>
              <div className={`flex items-center justify-between border-b-2 px-1 pb-1 ${group.underline || 'border-slate-200 dark:border-slate-700'}`}>
                <h3 className={`text-base font-black ${group.tone}`}>{group.title}</h3>
                <span className="text-sm font-black text-slate-500 dark:text-slate-400">{group.foods.length}</span>
              </div>
              {groupItemsByCategory(group.foods).map((categoryGroup) => (
                <div className="space-y-2" key={categoryGroup.key}>
                  <CategorySubheading count={categoryGroup.items.length} title={categoryGroup.title} />
                  {categoryGroup.items.map((food) => (
                    <FoodRow
                      food={food}
                      key={food.id}
                      onAdd={() => addProduct(food.id)}
                      onDecrement={() => changeQuantity(food.id, -1)}
                      onEdit={canManageItems && (session.is_admin || food.created_by === session.user_id) ? () => openEditor(food) : null}
                      onIncrement={() => changeQuantity(food.id, 1)}
                      onRate={canManageItems && isRateableFood(food) ? (rating) => saveRating(food.id, rating) : null}
                      quantity={items[food.id]?.quantity || 0}
                      rating={ratings[food.id]}
                      ratingGroup={!canManageItems || group.key === 'not-rateable' ? group : null}
                      ratingBusy={ratingFoodId === food.id}
                    />
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      {confirmAction ? (
        <ConfirmSheet
          action={confirmAction}
          busy={submitting}
          onCancel={() => setConfirmAction(null)}
          onConfirm={confirmSave}
        />
      ) : null}

      {editingFood && editingValues ? (
        <EditFoodSheet
          busy={editingBusy}
          categoryOptions={categoryOptions}
          food={editingFood}
          onDelete={session.is_admin ? deleteFood : null}
          onRequestClose={requestCloseEditor}
          onSave={saveFoodEdit}
          onValuesChange={setEditingValues}
          values={editingValues}
        />
      ) : null}

      {addingFood ? (
        <FoodDetailsSheet
          busy={editingBusy}
          categoryOptions={categoryOptions}
          onClose={() => setAddingFood(false)}
          onSave={addManualFood}
          onValuesChange={setNewFoodValues}
          title="מוצר חדש"
          values={newFoodValues}
        />
      ) : null}

      {confirmEditClose ? (
        <UnsavedChangesSheet
          onCancel={() => setConfirmEditClose(false)}
          onConfirm={closeEditor}
        />
      ) : null}

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

function FoodRow({ food, onAdd, onDecrement, onEdit, onIncrement, onRate, quantity, rating, ratingBusy, ratingGroup }) {
  const rank = ratingGroup || rankMetaForRating(rating)

  return (
    <article className={`rounded-2xl bg-white p-3 shadow-sm ring-1 ${rank.ring} dark:bg-slate-900`}>
      <div className="flex items-center gap-3">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-cyan-100 dark:bg-slate-800">
        {food.picture_url ? (
          <img alt="" className="h-full w-full object-cover" src={food.picture_url} />
        ) : (
          <span className="text-lg font-black text-rose-500">{food.name?.slice(0, 1) || '?'}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-2 font-black leading-tight">{food.name}</h3>
        <p className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">{food.manufacturer || DEFAULT_MANUFACTURER}</p>
        <p className="mt-1 text-sm font-black text-rose-700 dark:text-cyan-300">{food.unit_qty || 'יחידת מידה לא צוינה'}</p>
        {ratingGroup ? (
          <span className={`mt-2 inline-flex rounded-lg px-2 py-1 text-xs font-black ${ratingGroup.badge}`}>{ratingGroup.title}</span>
        ) : null}
      </div>
      {onEdit ? (
        <button
          aria-label={`עריכת ${food.name}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
          onClick={onEdit}
          title="עריכה"
          type="button"
        >
          <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24">
            <path d="m16.9 3.6 3.5 3.5" />
            <path d="M19.3 8.2 8.7 18.8 4 20l1.2-4.7L15.8 4.7a2.2 2.2 0 0 1 3.1 0l.4.4a2.2 2.2 0 0 1 0 3.1Z" />
          </svg>
        </button>
      ) : null}
      {quantity > 0 ? (
        <div className="flex items-center rounded-xl border border-rose-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <button className="h-11 w-11 text-xl font-black" onClick={onDecrement} type="button">
            -
          </button>
          <span className="min-w-8 text-center font-black">{quantity}</span>
          <button className="h-11 w-11 text-xl font-black" onClick={onIncrement} type="button">
            +
          </button>
        </div>
      ) : (
        <button className="h-11 rounded-xl bg-rose-600 px-4 font-black text-white" onClick={onAdd} type="button">
          הוספה
        </button>
      )}
      </div>

      {onRate ? (
        <div className="mt-3 flex items-center gap-1 overflow-x-auto border-t border-rose-100 pt-3 dark:border-slate-800">
          <span className="shrink-0 text-xs font-black text-slate-500 dark:text-slate-400">דירוג</span>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => (
            <button
              className={`h-9 min-w-9 rounded-xl text-sm font-black transition ${ratingColorClass(value, rating === value)}`}
              disabled={ratingBusy}
              key={value}
              onClick={() => onRate(value)}
              type="button"
            >
              {value}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  )
}

function EditFoodSheet({ busy, categoryOptions, food, onDelete, onRequestClose, onSave, onValuesChange, values }) {
  const options = ensureCategoryOption(categoryOptions, values.category)
  const rateable = isRateableFood({ ...food, ...values })

  function setField(field, value) {
    onValuesChange((current) => ({ ...current, [field]: value }))
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-auto rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-xl font-black">עריכת מוצר</h3>
            <p className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">{food.name}</p>
          </div>
          <button
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
            onClick={onRequestClose}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm font-black text-slate-600 dark:text-slate-300">שם</span>
            <input
              className="h-12 w-full rounded-xl border border-rose-200 bg-white px-3 text-base outline-none focus:border-rose-600 focus:ring-4 focus:ring-rose-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-rose-900/40"
              onChange={(event) => setField('name', event.target.value)}
              value={values.name}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-black text-slate-600 dark:text-slate-300">קטגוריה</span>
            <select
              className="h-12 w-full rounded-xl border border-rose-200 bg-white px-3 text-base font-bold outline-none focus:border-rose-600 focus:ring-4 focus:ring-rose-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-rose-900/40"
              onChange={(event) => setField('category', event.target.value)}
              value={values.category}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-sm font-black text-slate-600 dark:text-slate-300">יצרן</span>
              <input
                className="h-12 w-full rounded-xl border border-rose-200 bg-white px-3 text-base outline-none focus:border-rose-600 focus:ring-4 focus:ring-rose-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-rose-900/40"
                onChange={(event) => setField('manufacturer', event.target.value)}
                value={values.manufacturer}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-black text-slate-600 dark:text-slate-300">משקל</span>
              <input
                className="h-12 w-full rounded-xl border border-rose-200 bg-white px-3 text-base outline-none focus:border-rose-600 focus:ring-4 focus:ring-rose-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-rose-900/40"
                onChange={(event) => setField('unit_qty', event.target.value)}
                value={values.unit_qty}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-black text-slate-600 dark:text-slate-300">קישור תמונה</span>
            <input
              className="h-12 w-full rounded-xl border border-rose-200 bg-white px-3 text-base outline-none focus:border-rose-600 focus:ring-4 focus:ring-rose-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-rose-900/40"
              dir="ltr"
              onChange={(event) => setField('picture_url', event.target.value)}
              value={values.picture_url}
            />
          </label>

          {rateable ? <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-black text-slate-600 dark:text-slate-300">דירוג</span>
              <button
                className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                onClick={() => setField('rating', '')}
                type="button"
              >
                ללא דירוג
              </button>
            </div>
            <div className="grid grid-cols-5 gap-1">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => (
                <button
                  className={`h-10 rounded-xl text-sm font-black ${ratingColorClass(value, Number(values.rating) === value)}`}
                  key={value}
                  onClick={() => setField('rating', value)}
                  type="button"
                >
                  {value}
                </button>
              ))}
            </div>
          </div> : (
            <div className="rounded-xl bg-sky-50 p-3 text-sm font-black text-sky-800 dark:bg-sky-500/10 dark:text-sky-200">
              מרכיב בישול – ללא דירוג
            </div>
          )}
        </div>

        <div className={`mt-5 grid gap-2 ${onDelete ? 'grid-cols-[1fr_auto]' : 'grid-cols-1'}`}>
          <button
            className="rounded-xl bg-rose-600 px-3 py-3 font-black text-white disabled:opacity-60"
            disabled={busy}
            onClick={onSave}
            type="button"
          >
            {busy ? 'שומר...' : 'שמירה'}
          </button>
          {onDelete ? (
            <button
              className="rounded-xl bg-red-50 px-3 py-3 font-black text-red-700 disabled:opacity-60 dark:bg-red-500/10 dark:text-red-200"
              disabled={busy}
              onClick={onDelete}
              title="מחיקה"
              type="button"
            >
              מחיקה
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function FoodDetailsSheet({ busy, categoryOptions, onClose, onSave, onValuesChange, title, values }) {
  const options = categoryOptions.filter((option) => option.value !== ALL_CATEGORIES)

  function setField(field, value) {
    onValuesChange((current) => ({ ...current, [field]: value }))
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-auto rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-xl font-black">{title}</h3>
          <button className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 font-black dark:bg-slate-800" disabled={busy} onClick={onClose} type="button">×</button>
        </div>

        <div className="space-y-3">
          <RequiredField label="שם מוצר">
            <input className={foodInputClass} onChange={(event) => setField('name', event.target.value)} required value={values.name} />
          </RequiredField>
          <RequiredField label="יצרן">
            <div className="flex gap-2">
              <input className={foodInputClass} onChange={(event) => setField('manufacturer', event.target.value)} required value={values.manufacturer} />
              <button className="shrink-0 rounded-xl bg-cyan-100 px-3 text-xs font-black text-cyan-950" onClick={() => setField('manufacturer', DEFAULT_MANUFACTURER)} type="button">רמי לוי</button>
            </div>
          </RequiredField>
          <RequiredField label="קטגוריה">
            <select className={foodInputClass} onChange={(event) => setField('category', event.target.value)} required value={values.category}>
              <option value="">בחירת קטגוריה</option>
              {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </RequiredField>
          <RequiredField label="כמות ויחידה">
            <input className={foodInputClass} onChange={(event) => setField('unit_qty', event.target.value)} placeholder="לדוגמה: 500 גרם" required value={values.unit_qty} />
          </RequiredField>
          <RequiredField label="קישור לתמונה">
            <input className={foodInputClass} dir="ltr" onChange={(event) => setField('picture_url', event.target.value)} placeholder="https://..." required type="url" value={values.picture_url} />
          </RequiredField>
        </div>

        <button className="mt-5 h-12 w-full rounded-xl bg-rose-600 font-black text-white disabled:opacity-50" disabled={busy || !allFoodFieldsPresent(cleanFoodValues(values))} onClick={onSave} type="button">
          {busy ? 'שומר...' : 'הוספת מוצר'}
        </button>
      </div>
    </div>
  )
}

const foodInputClass = 'h-12 w-full rounded-xl border border-rose-200 bg-white px-3 text-base outline-none focus:border-rose-600 focus:ring-4 focus:ring-rose-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-rose-900/40'

function RequiredField({ children, label }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-black text-slate-600 dark:text-slate-300">{label} *</span>
      {children}
    </label>
  )
}

function ensureCategoryOption(options, value) {
  if (!value || options.some((option) => option.value === value)) return options
  return [...options, { value, label: value }]
}

function UnsavedChangesSheet({ onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/65 p-4">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-auto rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900">
        <h3 className="text-xl font-black">יש שינויים שלא נשמרו</h3>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">לבטל את העריכה בלי לשמור?</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            className="rounded-xl bg-slate-100 px-3 py-3 font-black text-slate-700 dark:bg-slate-800 dark:text-slate-200"
            onClick={onCancel}
            type="button"
          >
            המשך עריכה
          </button>
          <button
            className="rounded-xl bg-rose-600 px-3 py-3 font-black text-white"
            onClick={onConfirm}
            type="button"
          >
            בטל שינויים
          </button>
        </div>
      </div>
    </div>
  )
}

function buildEditValues(food, rating) {
  return {
    category: getFoodCategory(food),
    manufacturer: food?.manufacturer || DEFAULT_MANUFACTURER,
    name: food?.name || '',
    picture_url: food?.picture_url || '',
    rating: rating ?? '',
    unit_qty: food?.unit_qty || '',
  }
}

function emptyFoodValues() {
  return { category: '', manufacturer: '', name: '', picture_url: '', unit_qty: '' }
}

function cleanFoodValues(values) {
  return {
    category: values.category?.trim() || '',
    manufacturer: values.manufacturer?.trim() || '',
    name: values.name?.trim() || '',
    picture_url: values.picture_url?.trim() || '',
    unit_qty: values.unit_qty?.trim() || '',
  }
}

function allFoodFieldsPresent(values) {
  return Object.values(values).every(Boolean)
}

function hasEditChanges(food, values, rating) {
  if (!food || !values) return false
  const baseline = buildEditValues(food, rating)
  return Object.keys(baseline).some((key) => String(baseline[key] ?? '') !== String(values[key] ?? ''))
}

function sortFoodsByName(foods) {
  return [...foods].sort((a, b) => {
    const nameCompare = String(a.name || '').localeCompare(String(b.name || ''), 'he', { sensitivity: 'base' })
    if (nameCompare !== 0) return nameCompare
    return String(a.manufacturer || '').localeCompare(String(b.manufacturer || ''), 'he', { sensitivity: 'base' })
  })
}

function EmptyState({ text }) {
  return <div className="rounded-2xl border border-dashed border-rose-200 bg-white p-8 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">{text}</div>
}

function ConfirmSheet({ action, busy, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-auto rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900">
        <h3 className="text-xl font-black">{action.title}</h3>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{action.message}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            className="rounded-xl bg-slate-100 px-3 py-3 font-black text-slate-700 dark:bg-slate-800 dark:text-slate-200"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            ביטול
          </button>
          <button
            className="rounded-xl bg-rose-600 px-3 py-3 font-black text-white disabled:opacity-60"
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? 'מבצע...' : action.confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
