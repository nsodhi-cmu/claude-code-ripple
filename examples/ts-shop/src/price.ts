export function formatPrice(amount: number): string {
  return currencySymbol() + toFixed2(amount)
}

export function toFixed2(amount: number): string {
  return amount.toFixed(2)
}

export function currencySymbol(): string {
  return '$'
}
