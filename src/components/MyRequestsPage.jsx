import { useCallback, useEffect, useState } from 'react'
import { formatCurrency, formatDate, requestStatusLabels } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh'

const realtimeTables = ['requests', 'request_items']

export default function MyRequestsPage({ user }) {
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
        fulfiller:profiles!requests_fulfiller_id_fkey(display_name, email),
        items:request_items(
          id,
          quantity,
          is_found,
          product:products(id, name, price, image_url, brand, unit_qty)
        )
      `)
      .eq('requester_id', user.id)
      .order('created_at', { ascending: false })

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

  useRealtimeRefresh(`my-requests-${user.id}`, realtimeTables, loadRequests)

  const cancelRequest = async (requestId) => {
    setSavingId(requestId)
    setError('')

    const { error: updateError } = await supabase
      .from('requests')
      .update({ status: 'cancelled' })
      .eq('id', requestId)
      .eq('requester_id', user.id)

    setSavingId(null)

    if (updateError) {
      setError(updateError.message)
      return
    }

    await loadRequests()
  }

  const changeItemQuantity = async (requestId, item, delta) => {
    setSavingId(item.id)
    setError('')

    const nextQuantity = item.quantity + delta
    const result =
      nextQuantity <= 0
        ? await supabase.from('request_items').delete().eq('id', item.id)
        : await supabase.from('request_items').update({ quantity: nextQuantity }).eq('id', item.id)

    setSavingId(null)

    if (result.error) {
      setError(result.error.message)
      return
    }

    const request = requests.find((entry) => entry.id === requestId)
    if (nextQuantity <= 0 && request?.items?.length === 1) {
      await cancelRequest(requestId)
      return
    }

    await loadRequests()
  }

  return (
    <section>
      <div className="mb-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-2xl font-bold">הבקשות שלי</h2>
        <p className="mt-1 text-sm text-slate-500">מעקב וניהול בקשות ששלחתם.</p>
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      {loading ? (
        <EmptyState text="טוען בקשות..." />
      ) : requests.length === 0 ? (
        <EmptyState text="עוד לא שלחתם בקשות." />
      ) : (
        <div className="space-y-4">
          {requests.map((request) => (
            <RequestCard
              key={request.id}
              onCancel={() => cancelRequest(request.id)}
              onQuantityChange={(item, delta) => changeItemQuantity(request.id, item, delta)}
              request={request}
              savingId={savingId}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function RequestCard({ onCancel, onQuantityChange, request, savingId }) {
  const canEdit = request.status === 'pending'
  const total = (request.items || []).reduce(
    (sum, item) => sum + Number(item.product?.price || 0) * item.quantity,
    0
  )

  return (
    <article className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold">בקשה מ-{formatDate(request.created_at)}</h3>
            <StatusPill status={request.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {request.fulfiller
              ? `נאספה על ידי ${request.fulfiller.display_name || request.fulfiller.email}`
              : 'ממתינה למשתמש שייקח את הבקשה'}
          </p>
        </div>
        <div className="text-sm font-semibold text-slate-700">הערכה: {formatCurrency(total)}</div>
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
            {canEdit ? (
              <div className="inline-flex items-center rounded-md border border-slate-300">
                <button
                  className="h-9 w-9 text-lg font-bold transition hover:bg-slate-100 disabled:opacity-50"
                  disabled={savingId === item.id}
                  onClick={() => onQuantityChange(item, -1)}
                  type="button"
                >
                  -
                </button>
                <span className="min-w-9 text-center text-sm font-bold">{item.quantity}</span>
                <button
                  className="h-9 w-9 text-lg font-bold transition hover:bg-slate-100 disabled:opacity-50"
                  disabled={savingId === item.id}
                  onClick={() => onQuantityChange(item, 1)}
                  type="button"
                >
                  +
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-slate-100 px-2 py-1 text-sm font-bold">x{item.quantity}</span>
                {request.status !== 'pending' ? (
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-bold ${
                      item.is_found ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {item.is_found ? 'נמצא' : 'לא סומן'}
                  </span>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>

      {request.notes ? (
        <div className="mx-4 mb-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">{request.notes}</div>
      ) : null}

      {canEdit ? (
        <div className="border-t border-slate-100 p-4">
          <button
            className="rounded-md border border-red-200 px-3 py-2 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={savingId === request.id}
            onClick={onCancel}
            type="button"
          >
            ביטול בקשה
          </button>
        </div>
      ) : null}
    </article>
  )
}

function StatusPill({ status }) {
  const classes = {
    pending: 'bg-amber-100 text-amber-800',
    claimed: 'bg-sky-100 text-sky-800',
    fulfilled: 'bg-emerald-100 text-emerald-800',
    cancelled: 'bg-slate-100 text-slate-600',
  }

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${classes[status] || classes.pending}`}>
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
