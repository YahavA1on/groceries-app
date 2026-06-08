import { useRef } from 'react'
import { ALL_CATEGORIES } from '../lib/foodFilters'

export default function FoodFilterBar({
  category,
  categoryOptions = [],
  onCategoryChange,
  onSearchChange,
  placeholder = 'חיפוש מוצר...',
  search,
}) {
  const railRef = useRef(null)
  const options =
    categoryOptions.length > 0
      ? categoryOptions
      : [{ value: ALL_CATEGORIES, label: 'כל הקטגוריות', icon: '☰' }]
  const categoryButtons = options.filter((option) => option.value !== ALL_CATEGORIES)

  function selectCategory(value, element) {
    onCategoryChange(category === value ? ALL_CATEGORIES : value)
    element.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })

    window.setTimeout(() => {
      const rail = railRef.current
      if (!rail) return
      const direction = getComputedStyle(rail).direction === 'rtl' ? -1 : 1
      rail.scrollBy({ left: direction * 52, behavior: 'smooth' })
    }, 120)
  }

  return (
    <div className="space-y-3 rounded-2xl bg-white p-3 shadow-sm dark:bg-slate-900">
      <input
        className="h-12 w-full rounded-xl border border-rose-200 bg-white px-3 text-base outline-none focus:border-rose-600 focus:ring-4 focus:ring-rose-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-rose-900/40"
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={placeholder}
        type="search"
        value={search}
      />

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" ref={railRef}>
        {categoryButtons.map((option) => {
          const isActive = category === option.value

          return (
            <button
              aria-pressed={isActive}
              className={`flex w-20 shrink-0 flex-col items-center gap-1 border-b-2 px-1 pb-2 pt-1 text-center transition ${
                isActive
                  ? 'border-blue-500 text-blue-600 dark:border-cyan-300 dark:text-cyan-200'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
              key={option.value}
              onClick={(event) => selectCategory(option.value, event.currentTarget)}
              title={option.label}
              type="button"
            >
              <span aria-hidden="true" className="h-7 text-2xl leading-none">
                {option.icon || '•'}
              </span>
              <span className="min-h-8 text-xs font-bold leading-tight">{option.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
