import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCart } from '../hooks/useCart'
import { formatCurrency } from '../lib/format'
import { supabase } from '../lib/supabase'

export default function CatalogPage({ onSubmitted }) {
  const { addProduct, changeQuantity, clearCart, count, items, lineItems, removeProduct } = useCart()
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const loadProducts = useCallback(async () => {
    setLoading(true)
    setError('')

    const { data, error: queryError } = await supabase
      .from('products')
      .select('id, external_id, barcode, name, price, image_url, category, brand, unit_qty, last_updated')
      .order('name', { ascending: true })

    if (queryError) {
      setError(queryError.message)
      setProducts([])
    } else {
      setProducts(data || [])
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    const timeoutId = setTimeout(loadProducts, 0)
    return () => clearTimeout(timeoutId)
  }, [loadProducts])

  const productById = useMemo(() => {
    const map = new Map()
    for (const product of products) map.set(product.id, product)
    return map
  }, [products])

  const categories = useMemo(() => {
    const found = new Set(products.map((product) => product.category).filter(Boolean))
    return ['all', ...Array.from(found).sort((a, b) => a.localeCompare(b, 'he'))]
  }, [products])

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase()
    return products.filter((product) => {
      const matchesCategory = category === 'all' || product.category === category
      const haystack = `${product.name} ${product.brand || ''} ${product.barcode || ''}`.toLowerCase()
      return matchesCategory && (!term || haystack.includes(term))
    })
  }, [category, products, search])

  const cartLines = useMemo(
    () =>
      lineItems
        .map((item) => ({ ...item, product: productById.get(item.productId) }))
        .filter((item) => item.product),
    [lineItems, productById]
  )

  const estimatedTotal = cartLines.reduce(
    (sum, item) => sum + Number(item.product.price || 0) * item.quantity,
    0
  )

  const submitRequest = async () => {
    if (cartLines.length === 0) return

    setSubmitting(true)
    setError('')
    setSuccess('')

    const { data: request, error: requestError } = await supabase
      .from('requests')
      .insert({ notes: notes.trim() || null })
      .select('id')
      .single()

    if (requestError) {
      setSubmitting(false)
      setError(requestError.message)
      return
    }

    const rows = cartLines.map((item) => ({
      request_id: request.id,
      product_id: item.productId,
      quantity: item.quantity,
    }))

    const { error: itemsError } = await supabase.from('request_items').insert(rows)

    if (itemsError) {
      await supabase.from('requests').delete().eq('id', request.id)
      setSubmitting(false)
      setError(itemsError.message)
      return
    }

    clearCart()
    setNotes('')
    setSubmitting(false)
    setSuccess('הבקשה נשלחה ללוח הבקשות.')
    onSubmitted?.()
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section>
        <div className="mb-5 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center">
          <div className="flex-1">
            <h2 className="text-2xl font-bold">קטלוג מוצרים</h2>
            <p className="mt-1 text-sm text-slate-500">בחרו מוצרים לבקשה חדשה.</p>
          </div>
          <button
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            onClick={loadProducts}
            type="button"
          >
            רענון
          </button>
        </div>

        <div className="mb-5 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_220px]">
          <input
            className="rounded-md border border-slate-300 px-3 py-2 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="חיפוש לפי שם, מותג או ברקוד"
            type="search"
            value={search}
          />
          <select
            className="rounded-md border border-slate-300 px-3 py-2 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            onChange={(event) => setCategory(event.target.value)}
            value={category}
          >
            {categories.map((entry) => (
              <option key={entry} value={entry}>
                {entry === 'all' ? 'כל הקטגוריות' : entry}
              </option>
            ))}
          </select>
        </div>

        {error ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : null}
        {success ? (
          <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {success}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
            טוען מוצרים...
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
            <h3 className="font-bold text-slate-800">אין מוצרים להצגה</h3>
            <p className="mt-2 text-sm text-slate-500">הריצו את סקריפט הבדיקה כדי לטעון קטלוג ראשוני.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filteredProducts.map((product) => (
              <article
                className="flex min-h-44 flex-col rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
                key={product.id}
              >
                <div className="flex gap-3">
                  <ProductImage product={product} />
                  <div className="min-w-0 flex-1">
                    <h3 className="line-clamp-2 font-bold leading-snug text-slate-950">{product.name}</h3>
                    {product.brand ? <p className="mt-1 text-sm text-slate-500">{product.brand}</p> : null}
                    {product.unit_qty ? <p className="text-sm text-slate-500">{product.unit_qty}</p> : null}
                    {product.category ? (
                      <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                        {product.category}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                  <strong className="text-lg text-emerald-800">{formatCurrency(product.price)}</strong>
                  {items[product.id] ? (
                    <QuantityControls
                      onDecrement={() => changeQuantity(product.id, -1)}
                      onIncrement={() => changeQuantity(product.id, 1)}
                      quantity={items[product.id].quantity}
                    />
                  ) : (
                    <button
                      className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-bold text-white transition hover:bg-emerald-800"
                      onClick={() => addProduct(product.id)}
                      type="button"
                    >
                      הוספה
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <aside className="lg:sticky lg:top-36 lg:self-start">
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-4">
            <h2 className="text-xl font-bold">העגלה לבקשה</h2>
            <p className="mt-1 text-sm text-slate-500">{count} פריטים נבחרו</p>
          </div>

          {cartLines.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">בחרו מוצרים מהקטלוג כדי לבנות בקשה.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {cartLines.map((item) => (
                <div className="flex gap-3 p-4" key={item.productId}>
                  <ProductImage product={item.product} small />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-snug">{item.product.name}</p>
                    <p className="text-sm text-slate-500">{formatCurrency(item.product.price)}</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <QuantityControls
                        onDecrement={() => changeQuantity(item.productId, -1)}
                        onIncrement={() => changeQuantity(item.productId, 1)}
                        quantity={item.quantity}
                      />
                      <button
                        className="text-sm font-semibold text-red-600 hover:text-red-700"
                        onClick={() => removeProduct(item.productId)}
                        type="button"
                      >
                        הסרה
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-slate-200 p-4">
            <label className="mb-3 block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">הערות לבקשה</span>
              <textarea
                className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                onChange={(event) => setNotes(event.target.value)}
                placeholder="למשל: אם אין את המותג הזה, אפשר חלופה דומה"
                value={notes}
              />
            </label>
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="text-slate-500">הערכה לפי מחירי הקטלוג</span>
              <strong>{formatCurrency(estimatedTotal)}</strong>
            </div>
            <button
              className="w-full rounded-md bg-emerald-700 px-4 py-2.5 font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={cartLines.length === 0 || submitting}
              onClick={submitRequest}
              type="button"
            >
              {submitting ? 'שולח...' : 'שליחת בקשה'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}

function ProductImage({ product, small = false }) {
  const size = small ? 'h-14 w-14' : 'h-20 w-20'

  return (
    <div className={`${size} flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100`}>
      {product.image_url ? (
        <img alt="" className="h-full w-full object-cover" src={product.image_url} />
      ) : (
        <span className="text-lg font-bold text-slate-400">{product.name?.slice(0, 1) || '?'}</span>
      )}
    </div>
  )
}

function QuantityControls({ onDecrement, onIncrement, quantity }) {
  return (
    <div className="inline-flex items-center rounded-md border border-slate-300 bg-white">
      <button
        className="h-9 w-9 text-lg font-bold text-slate-700 transition hover:bg-slate-100"
        onClick={onDecrement}
        type="button"
      >
        -
      </button>
      <span className="min-w-9 text-center text-sm font-bold">{quantity}</span>
      <button
        className="h-9 w-9 text-lg font-bold text-slate-700 transition hover:bg-slate-100"
        onClick={onIncrement}
        type="button"
      >
        +
      </button>
    </div>
  )
}
