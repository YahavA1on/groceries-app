import { useContext } from 'react'
import { CartContext } from '../lib/cartContext'

export function useCart() {
  const cart = useContext(CartContext)
  if (!cart) throw new Error('useCart must be used inside CartProvider')
  return cart
}
