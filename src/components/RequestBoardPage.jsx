import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatCurrency, formatDate, initialsFor } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh'

const realtimeTables = ['requests', 'request_items']

export default function RequestBoardPage({ onClaimed, user }) {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [claimingId, setClaimingId] = useState(null)
  const [error, setError] = useState('')

  const loadRequests = useCallback(async () => {
    setLoading(true)
    setError('')

    const { data, error: queryError } = await supabase
      .from('requests')
      .select(`
        id,
        requester_id,
        notes,
        status,
        created_at,
        requester:profiles!requests_requester_id_fkey(display_name, email),
        items:request_items(
          id,
          quantity,
          is_found,
          product:products(id, name, price, image_url, brand, unit_qty)
        )
      `)
      .eq('status', 'pending')
      .neq('requester_id', user.id)
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

  useRealtimeRefresh(`request-board-${user.id}`, realtimeTables, loadRequests)

  const handleClaim = async (requestId) => {
    setClaimingId(requestId)
    setError('')

    const { error: claimError } = await supabase.rpc('claim_request', { p_request_id: requestId })
    setClaimingId(null)

    if (claimError) {
      setError(claimError.message)
      await loadRequests()
      return
    }

    onClaimed?.()
  }

  return (
    <section>
      <div className="mb-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-2xl font-bold">בקשות פתוחות</h2>
        <p className="mt-1 text-sm text-slate-500">בקשות של משתמשים אחרים שממתינות לאיסוף.</p>
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      {loading ? (
        <EmptyState text="טוען בקשות..." />
      ) : requests.length === 0 ? (
        <EmptyState text="אין כרגע בקשות פתוחות של משתמשים אחרים." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {requests.map((request) => (
            <OpenRequestCard
              claiming={claimingId === request.id}
              key={request.id}
              onClaim={() => handleClaim(request.id)}
              request={request}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function OpenRequestCard({ claiming, onClaim, request }) {
  const total = useMemo(
    () =>
      (request.items || []).reduce(
        (sum, item) => sum + Number(item.product?.price || 0) * item.quantity,
        0
      ),
    [request.items]
  )

  return (
    <article className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-800">
            {initialsFor(request.requester)}
          </div>
          <div className="min-w-0">
            <h3 className="truncate font-bold">{request.requester?.display_name || request.requester?.email}</h3>
            <p className="text-sm text-slate-500">{formatDate(request.created_at)}</p>
          </div>
        </div>
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">פתוחה</span>
      </div>

      <div className="space-y-3 p-4">
        {(request.items || []).map((item) => (
          <div className="flex items-center gap-3" key={item.id}>
            <ProductThumb product={item.product} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-snug">{item.product?.name || 'מוצר נמחק'}</p>
              <p className="text-sm text-slate-500">
                {item.product?.brand ? `${item.product.brand} · ` : ''}
                {item.product?.unit_qty || formatCurrency(item.product?.price)}
              </p>
            </div>
            <strong className="rounded-md bg-slate-100 px-2 py-1 text-sm">x{item.quantity}</strong>
          </div>
        ))}
      </div>

      {request.notes ? (
        <div className="mx-4 mb-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">{request.notes}</div>
      ) : null}

      <div className="flex items-center justify-between gap-3 border-t border-slate-100 p-4">
        <span className="text-sm text-slate-500">הערכה: {formatCurrency(total)}</span>
        <button
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={claiming}
          onClick={onClaim}
          type="button"
        >
          {claiming ? 'תופס בקשה...' : 'לקחת לאיסוף'}
        </button>
      </div>
    </article>
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
