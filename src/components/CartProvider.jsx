import { useEffect, useMemo, useState } from 'react'
import { CartContext } from '../lib/cartContext'

function storageKeyFor(userId) {
  return `grocery_request_cart:${userId}`
}

function loadStoredCart(userId) {
  try {
    const raw = localStorage.getItem(storageKeyFor(userId))
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

export default function CartProvider({ userId, children }) {
  const storageKey = storageKeyFor(userId)
  const [items, setItems] = useState(() => loadStoredCart(userId))

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(items))
  }, [items, storageKey])

  const value = useMemo(() => {
    const lineItems = Object.values(items)
    const count = lineItems.reduce((sum, item) => sum + item.quantity, 0)

    return {
      items,
      lineItems,
      count,
      addProduct(productId) {
        setItems((current) => {
          const existing = current[productId]
          return {
            ...current,
            [productId]: {
              productId,
              quantity: existing ? existing.quantity + 1 : 1,
            },
          }
        })
      },
      changeQuantity(productId, delta) {
        setItems((current) => {
          const existing = current[productId]
          if (!existing) return current
          const nextQuantity = existing.quantity + delta
          if (nextQuantity <= 0) {
            const next = { ...current }
            delete next[productId]
            return next
          }
          return {
            ...current,
            [productId]: { ...existing, quantity: nextQuantity },
          }
        })
      },
      removeProduct(productId) {
        setItems((current) => {
          const next = { ...current }
          delete next[productId]
          return next
        })
      },
      clearCart() {
        setItems({})
      },
    }
  }, [items])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}
