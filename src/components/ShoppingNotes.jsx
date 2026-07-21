import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

function privateNotesKey(familyId, userId) {
  return `shopping_notes_private:${familyId}:${userId}`
}

function readPrivateNotes(familyId, userId) {
  try {
    return JSON.parse(localStorage.getItem(privateNotesKey(familyId, userId)) || '[]')
  } catch {
    return []
  }
}

export default function ShoppingNotes({ session }) {
  const familyId = session.family_id
  const [sharedNotes, setSharedNotes] = useState([])
  const [privateNotes, setPrivateNotes] = useState(() => readPrivateNotes(familyId, session.user_id))
  const [draft, setDraft] = useState('')
  const [choosingVisibility, setChoosingVisibility] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadSharedNotes = useCallback(async () => {
    const { data, error: notesError } = await supabase.rpc('list_family_notes', {
      p_session_token: session.token,
    })

    if (notesError) {
      setError('לא ניתן לטעון את ההערות המשותפות.')
      return
    }

    setError('')
    setSharedNotes(data || [])
  }, [session.token])

  useEffect(() => {
    const timeoutId = setTimeout(loadSharedNotes, 0)
    const intervalId = setInterval(loadSharedNotes, 15_000)
    return () => {
      clearTimeout(timeoutId)
      clearInterval(intervalId)
    }
  }, [loadSharedNotes])

  function requestSave() {
    if (!draft.trim()) return
    setChoosingVisibility(true)
  }

  function savePrivate() {
    const note = {
      id: `private-${Date.now()}`,
      body: draft.trim(),
      created_at: new Date().toISOString(),
    }
    const nextNotes = [note, ...privateNotes]
    localStorage.setItem(privateNotesKey(familyId, session.user_id), JSON.stringify(nextNotes))
    setPrivateNotes(nextNotes)
    setDraft('')
    setChoosingVisibility(false)
  }

  async function saveShared() {
    const body = draft.trim()
    if (!body) return

    setBusy(true)
    setError('')
    const { error: insertError } = await supabase.rpc('add_family_note', {
      p_session_token: session.token,
      p_body: body,
    })
    setBusy(false)

    if (insertError) {
      setError('לא ניתן לשמור את ההערה המשותפת.')
      return
    }

    setDraft('')
    setChoosingVisibility(false)
    await loadSharedNotes()
  }

  async function deleteShared(note) {
    setBusy(true)
    const { error: deleteError } = await supabase.rpc('delete_family_note', {
      p_session_token: session.token,
      p_note_id: note.id,
    })
    setBusy(false)

    if (deleteError) {
      setError('לא ניתן למחוק את ההערה.')
      return
    }
    await loadSharedNotes()
  }

  function deletePrivate(note) {
    const nextNotes = privateNotes.filter((entry) => entry.id !== note.id)
    localStorage.setItem(privateNotesKey(familyId, session.user_id), JSON.stringify(nextNotes))
    setPrivateNotes(nextNotes)
  }

  const notes = [
    ...privateNotes.map((note) => ({ ...note, private: true, author_name: session.username })),
    ...sharedNotes.map((note) => ({ ...note, private: false, author_name: note.author_name || 'משתמש' })),
  ].sort((left, right) => new Date(right.created_at) - new Date(left.created_at))

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-black">הערות</h3>
        {notes.length > 0 ? <span className="text-xs font-black text-slate-400">{notes.length}</span> : null}
      </div>

      {notes.length > 0 ? (
        <div className="mt-3 max-h-40 space-y-2 overflow-auto pe-1">
          {notes.map((note) => (
            <article className="rounded-xl bg-orange-50 p-3 dark:bg-slate-800" key={note.id}>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 whitespace-pre-wrap text-sm font-bold">{note.body}</p>
                {(note.private || note.author_id === session.user_id) ? (
                  <button
                    aria-label="מחיקת הערה"
                    className="shrink-0 rounded-lg px-2 py-1 text-xs font-black text-rose-700 dark:text-rose-200"
                    disabled={busy}
                    onClick={() => (note.private ? deletePrivate(note) : deleteShared(note))}
                    type="button"
                  >
                    מחק
                  </button>
                ) : null}
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs font-black text-slate-500 dark:text-slate-400">
                <span>{note.author_name}</span>
                <span className={note.private ? 'text-indigo-600 dark:text-indigo-300' : 'text-cyan-700 dark:text-cyan-300'}>
                  {note.private ? 'רק לי' : 'לכולם'}
                </span>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex items-end gap-2">
        <textarea
          className="min-h-12 max-h-28 flex-1 resize-y rounded-xl border border-rose-200 bg-white px-3 py-3 text-base outline-none focus:border-rose-600 focus:ring-4 focus:ring-rose-100 dark:border-slate-700 dark:bg-slate-800 dark:focus:ring-rose-900/40"
          maxLength={300}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="הוספת הערה..."
          rows="1"
          value={draft}
        />
        <button
          className="h-12 rounded-xl bg-rose-600 px-4 font-black text-white disabled:opacity-50"
          disabled={!draft.trim() || busy}
          onClick={requestSave}
          type="button"
        >
          שמור
        </button>
      </div>
      {error ? <p className="mt-2 text-xs font-bold text-red-600 dark:text-red-300">{error}</p> : null}

      {choosingVisibility ? (
        <div className="app-modal-overlay bg-slate-950/55">
          <div className="app-modal-panel rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900">
            <h3 className="text-xl font-black">למי לשמור?</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">הערה פרטית נשמרת רק במכשיר הזה.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button className="rounded-xl bg-indigo-100 px-3 py-3 font-black text-indigo-900 dark:bg-indigo-500/20 dark:text-indigo-100" disabled={busy} onClick={savePrivate} type="button">
                רק לי
              </button>
              <button className="rounded-xl bg-rose-600 px-3 py-3 font-black text-white disabled:opacity-50" disabled={busy} onClick={saveShared} type="button">
                {busy ? 'שומר...' : 'לכולם'}
              </button>
            </div>
            <button className="mt-2 w-full rounded-xl bg-slate-100 px-3 py-3 font-black text-slate-700 dark:bg-slate-800 dark:text-slate-200" disabled={busy} onClick={() => setChoosingVisibility(false)} type="button">
              ביטול
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
