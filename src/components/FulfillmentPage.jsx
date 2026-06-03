import { useCallback, useEffect, useState } from 'react'
import { formatCurrency, formatDate, initialsFor, requestStatusLabels } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh'

const realtimeTables = ['requests', 'request_items']

export default function FulfillmentPage({ user }) {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [error, setError] = useState('')

  const loadRequests = useCallback(async () => {
    setLoading(true)
    setError('')

    const { data, error: queryError } = await supabase
      .from('requests')
      .select(`
        id,
        requester_id,
        fulfiller_id,
        notes,
        status,
        created_at,
        claimed_at,
        fulfilled_at,
        requester:profiles!requests_requester_id_fkey(display_name, email),
        items:request_items(
          id,
          quantity,
          is_found,
          product:products(id, name, price, image_url, brand, unit_qty)
        )
      `)
      .eq('fulfiller_id', user.id)
      .in('status', ['claimed', 'fulfilled'])
      .order('updated_at', { ascending: false })

    if (queryError) {
      setError(queryError.message)
      setRequests([])
    } else {
      setRequests(data || [])
    }

    setLoading(false)
  }, [user.id])

  useEffect(() => {
    const timeoutId = setTimeout(loadRequests, 0)
    return () => clearTimeout(timeoutId)
  }, [loadRequests])

  useRealtimeRefresh(`fulfillment-${user.id}`, realtimeTables, loadRequests)

  const toggleFound = async (item) => {
    setSavingId(item.id)
    setError('')

    const { error: updateError } = await supabase
      .from('request_items')
      .update({ is_found: !item.is_found })
      .eq('id', item.id)

    setSavingId(null)

    if (updateError) {
      setError(updateError.message)
      return
    }

    await loadRequests()
  }

  const fulfillRequest = async (requestId) => {
    setSavingId(requestId)
    setError('')

    const { error: rpcError } = await supabase.rpc('fulfill_request', { p_request_id: requestId })
    setSavingId(null)

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    await loadRequests()
  }

  return (
    <section>
      <div className="mb-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-2xl font-bold">איסופים שלי</h2>
        <p className="mt-1 text-sm text-slate-500">בקשות שלקחתם לאחריות וסימון פריטים בזמן הקניה.</p>
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      {loading ? (
        <EmptyState text="טוען איסופים..." />
      ) : requests.length === 0 ? (
        <EmptyState text="אין בקשות באיסוף כרגע." />
      ) : (
        <div className="space-y-4">
          {requests.map((request) => (
            <FulfillmentCard
              key={request.id}
              onFulfill={() => fulfillRequest(request.id)}
              onToggleFound={toggleFound}
              request={request}
              savingId={savingId}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function FulfillmentCard({ onFulfill, onToggleFound, request, savingId }) {
  const isActive = request.status === 'claimed'
  const foundCount = (request.items || []).filter((item) => item.is_found).length
  const total = (request.items || []).reduce(
    (sum, item) => sum + Number(item.product?.price || 0) * item.quantity,
    0
  )

  return (
    <article className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-100 font-bold text-sky-800">
            {initialsFor(request.requester)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-bold">בקשה של {request.requester?.display_name || request.requester?.email}</h3>
              <StatusPill status={request.status} />
            </div>
            <p className="text-sm text-slate-500">
              נשלחה {formatDate(request.created_at)} · הערכה {formatCurrency(total)}
            </p>
          </div>
        </div>
        <div className="text-sm font-bold text-slate-700">
          {foundCount}/{request.items?.length || 0} סומנו
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {(request.items || []).map((item) => (
          <div className="flex items-center gap-3 p-4" key={item.id}>
            <ProductThumb product={item.product} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-snug">{item.product?.name || 'מוצר נמחק'}</p>
              <p className="text-sm text-slate-500">
                {item.product?.brand ? `${item.product.brand} · ` : ''}
                {item.product?.unit_qty || formatCurrency(item.product?.price)}
              </p>
            </div>
            <span className="rounded-md bg-slate-100 px-2 py-1 text-sm font-bold">x{item.quantity}</span>
            <button
              className={`rounded-md px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                item.is_found
                  ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                  : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
              disabled={!isActive || savingId === item.id}
              onClick={() => onToggleFound(item)}
              type="button"
            >
              {item.is_found ? 'נמצא' : 'סמן נמצא'}
            </button>
          </div>
        ))}
      </div>

      {request.notes ? (
        <div className="mx-4 mb-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">{request.notes}</div>
      ) : null}

      {isActive ? (
        <div className="flex flex-col gap-3 border-t border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-500">אפשר להשלים גם אם חלק מהפריטים לא נמצאו.</p>
          <button
            className="rounded-md bg-emerald-700 px-4 py-2 font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={savingId === request.id}
            onClick={onFulfill}
            type="button"
          >
            {savingId === request.id ? 'משלים...' : 'סיום איסוף'}
          </button>
        </div>
      ) : null}
    </article>
  )
}

function StatusPill({ status }) {
  const classes = {
    claimed: 'bg-sky-100 text-sky-800',
    fulfilled: 'bg-emerald-100 text-emerald-800',
  }

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${classes[status] || 'bg-slate-100 text-slate-600'}`}>
      {requestStatusLabels[status] || status}
    </span>
  )
}

function ProductThumb({ product }) {
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
      {product?.image_url ? (
        <img alt="" className="h-full w-full object-cover" src={product.image_url} />
      ) : (
        <span className="font-bold text-slate-400">{product?.name?.slice(0, 1) || '?'}</span>
      )}
    </div>
  )
}

function EmptyState({ text }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">{text}</div>
  )
}
