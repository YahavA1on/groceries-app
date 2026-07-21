export function FamilyRatingPicker({ members, onChange, selectedMemberId }) {
  if (members.length === 0) return null
  return (
    <section className="rounded-2xl bg-white p-3 shadow-sm dark:bg-slate-900">
      <p className="mb-2 text-xs font-black text-slate-500 dark:text-slate-400">הדירוגים של</p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {members.map((member) => (
          <button className={pickerClass(selectedMemberId === member.user_id)} key={member.user_id} onClick={() => onChange(member.user_id)} type="button">{member.username}</button>
        ))}
        <button className={pickerClass(selectedMemberId === 'all')} onClick={() => onChange('all')} type="button">כולם</button>
      </div>
    </section>
  )
}

export function FamilyRatingSummary({ commonGround, details, visible }) {
  if (!visible) return null
  return (
    <div className={`mt-3 border-t pt-2 ${commonGround ? 'border-emerald-300' : 'border-slate-100 dark:border-slate-800'}`}>
      <div className="flex flex-wrap items-center gap-2">
        {details.length > 0 ? details.map((item) => (
          <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200" key={item.userId}>{item.username} – {item.rating}</span>
        )) : <span className="text-xs text-slate-400">אין עדיין דירוגים למוצר.</span>}
        {commonGround ? <span className="rounded-lg bg-emerald-100 px-2 py-1 text-xs font-black text-emerald-800 dark:bg-emerald-400/20 dark:text-emerald-200">מכנה משותף</span> : null}
      </div>
    </div>
  )
}

function pickerClass(active) {
  return `shrink-0 rounded-xl px-3 py-2 text-sm font-black transition ${active ? 'bg-rose-600 text-white dark:bg-cyan-400 dark:text-slate-950' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`
}
