import { formatPrice } from './price'

export type Cart = {
  items: { name: string; price: number; qty: number }[]
  currency: string
}

export function renderCart(cart: Cart): string {
  let total = 0
  const lines: string[] = []
  for (const item of cart.items) {
    const lineTotal = item.price * item.qty
    total += lineTotal
    lines.push(`${item.qty} x ${item.name}: ${formatPrice(lineTotal)}`)
  }
  lines.push(`Total: ${formatPrice(total)}`)
  return lines.join('\n')
}
