const colors = {
  1: '#f97316', 2: '#f97316', 3: '#f97316', 4: '#f97316',
  5: '#eab308', 6: '#eab308', 7: '#eab308',
  8: '#22c55e', 9: '#22c55e', 10: '#22c55e',
}

export default function RatingPicker({ food, current, onSelect, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{food.name}</h3>
        <div className="rating-grid">
          {[1,2,3,4,5,6,7,8,9,10].map((n) => (
            <button
              key={n}
              onClick={() => onSelect(n)}
              style={{
                background: colors[n],
                opacity: current === n ? 1 : 0.6,
                boxShadow: current === n ? `0 0 0 2px #2a2a2a, 0 0 0 4px ${colors[n]}` : '0 1px 3px rgba(0, 0, 0, 0.3)',
              }}
            >
              {n}
            </button>
          ))}
        </div>
        <button className="cancel" onClick={onClose}>ביטול</button>
      </div>
    </div>
  )
}