import { formatPrice } from './price'

export type Invoice = {
  id: string
  lines: { description: string; amount: number }[]
  currency: string
}

export function renderInvoice(invoice: Invoice): string {
  const total = invoice.lines.reduce((sum, line) => sum + line.amount, 0)
  return `Invoice ${invoice.id}: ${formatPrice(total)}`
}
