import { formatPrice } from './price'

export type Receipt = { to: string; total: number; currency: string }

export function emailReceipt(receipt: Receipt): string {
  return `To: ${receipt.to}\nThanks! You paid ${formatPrice(receipt.total)}.`
}
