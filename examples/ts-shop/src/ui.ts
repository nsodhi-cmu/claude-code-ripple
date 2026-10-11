import { formatPrice } from './price'

export function priceLabel(amount: number): string {
  return `Price: ${formatPrice(amount)}`
}
