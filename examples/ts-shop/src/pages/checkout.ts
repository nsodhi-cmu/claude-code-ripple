import { renderCart } from '../cart'
import type { Cart } from '../cart'

export function CheckoutPage(cart: Cart): string {
  return `# Checkout\n${renderCart(cart)}`
}
