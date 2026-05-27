import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNotifications } from '../lib/notifications'

export default function ReceiptQRScanner({ session, foods, onClose, onItemsAdded }) {
  const { notifySuccess, notifyError } = useNotifications()
  const [scanning, setScanning] = useState(false)
  const [scannedData, setScannedData] = useState(null)
  const [matchedItems, setMatchedItems] = useState([])
  const [unmatched, setUnmatched] = useState([])
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)

  // Start camera scanning
  useEffect(() => {
    if (!scanning) return

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play()
        }
      } catch (err) {
        notifyError('לא ניתן לגשת למצלמה: ' + err.message)
        setScanning(false)
      }
    }

    startCamera()
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
    }
  }, [scanning])

  // Attempt to decode QR code periodically
  useEffect(() => {
    if (!scanning || !videoRef.current) return

    const interval = setInterval(() => {
      if (canvasRef.current && videoRef.current) {
        const ctx = canvasRef.current.getContext('2d')
        canvasRef.current.width = videoRef.current.videoWidth
        canvasRef.current.height = videoRef.current.videoHeight
        ctx.drawImage(videoRef.current, 0, 0)

        try {
          // Try to detect QR using jsQR if available, otherwise use a simpler approach
          // For now, we'll use a placeholder that accepts manual JSON input
          // In production, you'd integrate a library like jsqr
        } catch (err) {
          console.log('QR scanning...')
        }
      }
    }, 300)

    return () => clearInterval(interval)
  }, [scanning])

  const handleManualInput = (jsonString) => {
    try {
      const data = JSON.parse(jsonString)
      processReceiptData(data)
    } catch (err) {
      notifyError('פורמט JSON לא תקין: ' + err.message)
    }
  }

  const processReceiptData = (receiptData) => {
    setScanning(false)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
    }

    // Extract items from receipt (format: { items: [{name, quantity, price}] })
    const receiptItems = receiptData.items || []

    // Fuzzy match receipt items to database foods
    const matched = []
    const unmatched_ = []

    for (const item of receiptItems) {
      const bestMatch = fuzzyFindFood(item.name, foods)
      if (bestMatch && bestMatch.score > 0.6) {
        matched.push({
          ...item,
          foodId: bestMatch.food.id,
          foodName: bestMatch.food.name,
          score: bestMatch.score
        })
      } else {
        unmatched_.push(item)
      }
    }

    setScannedData(receiptData)
    setMatchedItems(matched)
    setUnmatched(unmatched_)
  }

  const addToInventory = async () => {
    const ownerId = session.user_id
    const updates = matchedItems.map(item => ({
      owner_id: ownerId,
      food_id: item.foodId,
      quantity: item.quantity || 1,
      last_updated: new Date().toISOString()
    }))

    if (updates.length === 0) {
      notifyError('אין פריטים התואמים להוספה')
      return
    }

    const { error } = await supabase.from('inventory').upsert(updates, {
      onConflict: 'owner_id,food_id'
    })

    if (error) {
      notifyError('שגיאה בהוספה: ' + error.message)
      return
    }

    notifySuccess(`נוספו ${updates.length} פריטים למלאי! ✅`)
    onItemsAdded?.(matched)
    onClose()
  }

  if (!scanning && !scannedData) {
    return (
      <div className="qr-container" onClick={onClose}>
        <div className="qr-content" onClick={(e) => e.stopPropagation()}>
          <h3>סריקת קוד QR מהקבלה</h3>
          <p className="qr-info">סרוק קוד QR מהקבלה הדיגיטלית</p>
          
          <div className="scanner-buttons">
            <button 
              className="scan-btn"
              onClick={() => setScanning(true)}
            >
              🎥 התחל סריקה
            </button>
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>או</p>
            <ManualInput onSubmit={handleManualInput} />
          </div>

          <button onClick={onClose} className="qr-close-btn">סגור</button>
        </div>
      </div>
    )
  }

  if (scanning) {
    return (
      <div className="qr-container">
        <div className="scanner-modal">
          <h3>מכוון את המצלמה לקוד QR</h3>
          <video 
            ref={videoRef}
            className="scanner-video"
            style={{ width: '100%', maxHeight: '400px' }}
          />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <button 
            onClick={() => setScanning(false)}
            className="cancel-scan-btn"
          >
            ביטול
          </button>
        </div>
      </div>
    )
  }

  // Show matched items for confirmation
  return (
    <div className="qr-container" onClick={onClose}>
      <div className="qr-content" onClick={(e) => e.stopPropagation()}>
        <h3>תוצאות התאמה</h3>
        
        {matchedItems.length > 0 && (
          <div className="matched-items">
            <h4 style={{ color: '#22c55e' }}>התאמות ({matchedItems.length})</h4>
            {matchedItems.map((item, i) => (
              <div key={i} className="matched-item">
                <span>{item.foodName}</span>
                <span>×{item.quantity}</span>
              </div>
            ))}
          </div>
        )}

        {unmatched.length > 0 && (
          <div className="unmatched-items">
            <h4 style={{ color: '#f97316' }}>לא התאימו ({unmatched.length})</h4>
            {unmatched.map((item, i) => (
              <div key={i} className="unmatched-item">
                {item.name} - {item.quantity || 1}
              </div>
            ))}
          </div>
        )}

        <div className="action-buttons">
          <button 
            className="add-btn"
            onClick={addToInventory}
            disabled={matchedItems.length === 0}
          >
            הוסף {matchedItems.length} פריטים
          </button>
          <button 
            className="cancel-btn"
            onClick={() => {
              setScannedData(null)
              setMatchedItems([])
              setUnmatched([])
            }}
          >
            סרוק שוב
          </button>
        </div>

        <button onClick={onClose} className="qr-close-btn">סגור</button>
      </div>
    </div>
  )
}

function ManualInput({ onSubmit }) {
  const [json, setJson] = useState('')

  return (
    <div className="manual-input">
      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        placeholder='{"items": [{"name": "שם מוצר", "quantity": 1, "price": 10.5}]}'
        className="json-input"
      />
      <button 
        onClick={() => onSubmit(json)}
        className="submit-json-btn"
        disabled={!json.trim()}
      >
        עיבוד
      </button>
    </div>
  )
}

// Fuzzy string matching algorithm
function fuzzyFindFood(receiptName, foods) {
  let bestMatch = null
  let bestScore = 0

  const receiptNameLower = receiptName.toLowerCase().trim()

  for (const food of foods) {
    const foodNameLower = food.name.toLowerCase()
    const score = calculateSimilarity(receiptNameLower, foodNameLower)

    if (score > bestScore) {
      bestScore = score
      bestMatch = { food, score }
    }
  }

  return bestMatch
}

// Simple similarity score (0-1)
function calculateSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2
  const shorter = str1.length > str2.length ? str2 : str1

  if (longer.length === 0) return 1.0

  const editDistance = levenshteinDistance(longer, shorter)
  return (longer.length - editDistance) / longer.length
}

// Levenshtein distance for fuzzy matching
function levenshteinDistance(str1, str2) {
  const matrix = []

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i]
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }

  return matrix[str2.length][str1.length]
}
