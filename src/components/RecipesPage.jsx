import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TopNotice from './TopNotice'
import { fetchInventoryRows } from '../lib/foodData'
import { chooseRecipe, fetchRecipeSuggestions, refreshRecipeSuggestions } from '../lib/recipeData'
import { replaceStateWhenChanged } from '../lib/stateUpdates'
import { userErrorMessage } from '../lib/userErrors'

export default function RecipesPage({ session }) {
  const [recipes, setRecipes] = useState([])
  const [inventory, setInventory] = useState([])
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [selectedRecipe, setSelectedRecipe] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const autoSearchStarted = useRef(false)

  const loadPage = useCallback(async () => {
    const [recipesResult, inventoryResult] = await Promise.all([
      fetchRecipeSuggestions(session),
      fetchInventoryRows(session),
    ])
    const loadError = recipesResult.error || inventoryResult.error
    if (loadError) {
      setError(userErrorMessage(loadError))
      setLoading(false)
      return
    }
    replaceStateWhenChanged(setRecipes, recipesResult.data || [])
    replaceStateWhenChanged(setInventory, inventoryResult.data || [])
    setLoading(false)
  }, [session])

  const searchRecipes = useCallback(async () => {
    setSearching(true)
    setError('')
    setSuccess('')
    try {
      const result = await refreshRecipeSuggestions(session)
      const refreshed = await fetchRecipeSuggestions(session)
      if (refreshed.error) throw refreshed.error
      replaceStateWhenChanged(setRecipes, refreshed.data || [])
      if (result.reason === 'EMPTY_INVENTORY') setError('אין מוצרים במלאי שמהם אפשר להציע מתכונים.')
      else if (result.recipes === 0) setError('לא נמצאו כרגע מתכונים בעברית עם דירוג 4 ומעלה. נסו שוב מאוחר יותר.')
      else setSuccess(`נמצאו ${result.recipes} מתכונים שמתאימים למלאי.`)
    } catch (searchError) {
      setError(recipeServiceError(searchError))
    } finally {
      setSearching(false)
    }
  }, [session])

  useEffect(() => {
    const timeoutId = setTimeout(loadPage, 0)
    const intervalId = setInterval(() => loadPage(), 15_000)
    return () => {
      clearTimeout(timeoutId)
      clearInterval(intervalId)
    }
  }, [loadPage])

  useEffect(() => {
    if (loading || searching || inventory.length === 0 || recipes.length > 0 || autoSearchStarted.current) return
    autoSearchStarted.current = true
    void searchRecipes()
  }, [inventory.length, loading, recipes.length, searchRecipes, searching])

  const inventoryByFoodId = useMemo(
    () => new Map(inventory.map((row) => [row.food_id || row.food?.id, row])),
    [inventory],
  )

  async function confirmRecipe() {
    if (!selectedRecipe) return
    setChoosing(true)
    setError('')
    const result = await chooseRecipe(session, selectedRecipe.id)
    setChoosing(false)
    if (result.error) {
      setSelectedRecipe(null)
      setError(userErrorMessage(result.error))
      return
    }
    if (result.data?.error) {
      setSelectedRecipe(null)
      setError(selectionError(result.data))
      await loadPage()
      return
    }
    setSelectedRecipe(null)
    setSuccess(`המתכון נבחר. ${result.data?.deducted_count || 0} מרכיבים הופחתו מהמלאי.`)
    await loadPage()
  }

  return (
    <section className="space-y-4">
      <TopNotice notice={error ? { tone: 'error', text: error } : success ? { tone: 'success', text: success } : null} onDismiss={() => { setError(''); setSuccess('') }} />

      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-amber-500 via-orange-500 to-rose-600 p-5 text-white shadow-xl">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-100">מה אפשר להכין?</p>
        <h2 className="mt-1 text-3xl font-black">מתכונים מהמלאי</h2>
        <p className="mt-2 text-sm text-orange-50">מתכונים בעברית בדירוג 4 ומעלה, לפי המוצרים שכבר נמצאים בבית.</p>
        <button className="mt-4 w-full rounded-2xl bg-white/95 px-4 py-3 font-black text-rose-700 shadow-sm disabled:opacity-60" disabled={searching || inventory.length === 0} onClick={searchRecipes} type="button">
          {searching ? 'מחפש ומחשב כמויות...' : 'הצעות חדשות'}
        </button>
      </div>

      {loading ? <RecipeLoading /> : inventory.length === 0 ? (
        <EmptyState text="המלאי ריק. הוסיפו מוצרים כדי לקבל הצעות למתכונים." />
      ) : recipes.length === 0 && searching ? (
        <RecipeLoading text="מחפש מתכונים בעברית ומתאים אותם למלאי..." />
      ) : recipes.length === 0 ? (
        <EmptyState text="עדיין אין הצעות. לחצו על „הצעות חדשות”." />
      ) : (
        <div className="space-y-4">
          {recipes.map((recipe) => (
            <RecipeCard
              inventoryByFoodId={inventoryByFoodId}
              key={recipe.id}
              onChoose={() => setSelectedRecipe(recipe)}
              recipe={recipe}
            />
          ))}
        </div>
      )}

      {selectedRecipe ? (
        <RecipeConfirmation
          busy={choosing}
          inventoryByFoodId={inventoryByFoodId}
          onCancel={() => setSelectedRecipe(null)}
          onConfirm={confirmRecipe}
          recipe={selectedRecipe}
        />
      ) : null}
    </section>
  )
}

function RecipeCard({ inventoryByFoodId, onChoose, recipe }) {
  const ingredients = normalizedIngredients(recipe.ingredients)
  const availability = recipeAvailability(ingredients, inventoryByFoodId)
  return (
    <article className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-orange-100 dark:bg-slate-900 dark:ring-slate-800">
      {recipe.image_url ? <img alt="" className="h-44 w-full object-cover" src={recipe.image_url} /> : null}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-xl font-black leading-tight">{recipe.title}</h3>
            <a className="mt-1 inline-block text-xs font-bold text-slate-500 underline dark:text-slate-400" href={recipe.source_url} rel="noreferrer" target="_blank">{recipe.source_name}</a>
          </div>
          <div className="shrink-0 rounded-2xl bg-amber-100 px-3 py-2 text-center text-amber-900 dark:bg-amber-400/20 dark:text-amber-200">
            <p className="font-black">⭐ {formatNumber(recipe.rating)}</p>
            <p className="text-[0.65rem] font-bold">{recipe.reviews || 0} דירוגים</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-black">
          <span className="rounded-xl bg-orange-100 px-3 py-2 text-orange-800 dark:bg-orange-400/15 dark:text-orange-200">⏱ {formatTime(recipe.total_time_minutes)}</span>
          {recipe.servings ? <span className="rounded-xl bg-slate-100 px-3 py-2 text-slate-700 dark:bg-slate-800 dark:text-slate-200">🍽 {formatNumber(recipe.servings)} מנות</span> : null}
          <span className="rounded-xl bg-cyan-100 px-3 py-2 text-cyan-900 dark:bg-cyan-400/15 dark:text-cyan-200">{Number(recipe.inventory_match_percent || 0)}% מהמרכיבים בבית</span>
          <span className={`rounded-xl px-3 py-2 ${availability.ready ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200' : 'bg-red-100 text-red-800 dark:bg-red-400/15 dark:text-red-200'}`}>
            {availability.ready ? 'כל המרכיבים זמינים' : `${availability.missing} מרכיבים חסרים`}
          </span>
        </div>
        <div className="mt-4 space-y-2">
          {ingredients.map((ingredient, index) => <IngredientStatus ingredient={ingredient} inventoryByFoodId={inventoryByFoodId} key={`${ingredient.name}:${index}`} />)}
        </div>
        <button className="mt-4 w-full rounded-2xl bg-rose-600 px-4 py-3 font-black text-white disabled:bg-slate-200 disabled:text-slate-500 dark:disabled:bg-slate-800" disabled={!availability.ready} onClick={onChoose} type="button">
          {availability.ready ? 'בחירת מתכון' : 'חסרים מרכיבים לבחירה'}
        </button>
      </div>
    </article>
  )
}

function IngredientStatus({ ingredient, inventoryByFoodId }) {
  const status = ingredientAvailability(ingredient, inventoryByFoodId)
  return (
    <div className={`rounded-2xl border p-3 ${status.enough ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10' : 'border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`font-black ${status.enough ? 'text-emerald-900 dark:text-emerald-100' : 'text-red-900 dark:text-red-100'}`}>{ingredient.name}{ingredient.optional ? ' (לא חובה)' : ''}</p>
          <p className="mt-1 text-xs font-bold text-slate-600 dark:text-slate-300">צריך: {ingredient.required_text}</p>
        </div>
        <span className="text-lg" aria-hidden="true">{status.enough ? '✓' : '!'}</span>
      </div>
      <p className={`mt-2 text-xs font-black ${status.enough ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>{status.availableText}</p>
    </div>
  )
}

function RecipeConfirmation({ busy, inventoryByFoodId, onCancel, onConfirm, recipe }) {
  return (
    <div className="app-modal-overlay bg-slate-950/65" dir="rtl">
      <div className="app-modal-panel rounded-3xl bg-white p-5 shadow-2xl dark:bg-slate-900">
        <h3 className="text-2xl font-black">לבחור את המתכון?</h3>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">הכמויות הבאות יופחתו מיד מהמלאי עבור „{recipe.title}”.</p>
        <div className="mt-4 space-y-2">
          {normalizedIngredients(recipe.ingredients).filter((item) => !item.optional).map((ingredient, index) => {
            const row = inventoryByFoodId.get(ingredient.food_id)
            return (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800" key={`${ingredient.name}:${index}`}>
                <span className="font-black">{ingredient.name}</span>
                <span className="shrink-0 font-bold text-rose-700 dark:text-cyan-300">−{formatNumber(ingredient.inventory_quantity_required)} מתוך x{formatNumber(row?.quantity || 0)}</span>
              </div>
            )
          })}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button className="rounded-2xl bg-slate-100 px-4 py-3 font-black text-slate-700 dark:bg-slate-800 dark:text-slate-200" disabled={busy} onClick={onCancel} type="button">ביטול</button>
          <button className="rounded-2xl bg-rose-600 px-4 py-3 font-black text-white disabled:opacity-60" disabled={busy} onClick={onConfirm} type="button">{busy ? 'מעדכן מלאי...' : 'אישור והפחתה'}</button>
        </div>
      </div>
    </div>
  )
}

function normalizedIngredients(value) {
  return Array.isArray(value) ? value : []
}

function ingredientAvailability(ingredient, inventoryByFoodId) {
  if (ingredient.optional) return { enough: true, availableText: 'מרכיב לא חובה' }
  const row = inventoryByFoodId.get(ingredient.food_id)
  const available = Number(row?.quantity || 0)
  const required = Number(ingredient.inventory_quantity_required || 0)
  const enough = Boolean(ingredient.food_id) && required > 0 && available >= required
  if (!row) return { enough: false, availableText: 'אין מוצר מתאים במלאי' }
  const packageText = row.food?.unit_qty ? ` · ${row.food.unit_qty} ליחידה` : ''
  return {
    enough,
    availableText: `יש x${formatNumber(available)}${packageText}${required > 0 ? ` · נדרש x${formatNumber(required)}` : ''}`,
  }
}

function recipeAvailability(ingredients, inventoryByFoodId) {
  const required = ingredients.filter((ingredient) => !ingredient.optional)
  const missing = required.filter((ingredient) => !ingredientAvailability(ingredient, inventoryByFoodId).enough).length
  return { ready: required.length > 0 && missing === 0, missing }
}

function formatTime(minutes) {
  const value = Number(minutes || 0)
  if (value < 60) return `${value} דקות`
  const hours = Math.floor(value / 60)
  const rest = value % 60
  return rest ? `${hours} ש׳ ו־${rest} דק׳` : `${hours} שעות`
}

function formatNumber(value) {
  const number = Number(value || 0)
  return Number.isInteger(number) ? number : Number(number.toFixed(2))
}

function selectionError(result) {
  const ingredient = result.ingredient ? ` (${result.ingredient})` : ''
  if (result.error === 'MISSING_INGREDIENT') return `אין במלאי מוצר מתאים לאחד המרכיבים${ingredient}.`
  if (result.error === 'INSUFFICIENT_INGREDIENT') return `הכמות במלאי אינה מספיקה${ingredient}. המלאי עודכן מאז פתיחת המתכון.`
  if (result.error === 'RECIPE_NOT_FOUND') return 'המתכון כבר אינו זמין. רעננו את ההצעות.'
  return 'לא ניתן לבחור את המתכון כרגע.'
}

function recipeServiceError(error) {
  const message = String(error?.message || error)
  if (/SerpApi is not configured/i.test(message)) return 'שירות המתכונים עדיין לא הוגדר. יש להוסיף מפתח SerpApi.'
  if (/Gemini is not configured/i.test(message)) return 'שירות התאמת המרכיבים עדיין לא הוגדר.'
  if (/SerpApi|Gemini|recipe database|recipe service/i.test(message)) return 'לא ניתן לטעון הצעות למתכונים כרגע. נסו שוב מאוחר יותר.'
  return userErrorMessage(error)
}

function RecipeLoading({ text = 'טוען מתכונים...' }) {
  return (
    <div className="rounded-3xl bg-white p-8 text-center shadow-sm dark:bg-slate-900">
      <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-orange-100 border-t-rose-600 dark:border-slate-700 dark:border-t-cyan-400" />
      <p className="mt-3 text-sm font-black text-slate-500 dark:text-slate-400">{text}</p>
    </div>
  )
}

function EmptyState({ text }) {
  return <div className="rounded-3xl border border-dashed border-orange-200 bg-white p-8 text-center font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">{text}</div>
}
