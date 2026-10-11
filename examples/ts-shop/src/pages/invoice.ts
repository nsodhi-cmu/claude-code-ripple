import { renderInvoice } from '../invoice'
import type { Invoice } from '../invoice'

export function InvoicePage(invoice: Invoice): string {
  return `# Invoice\n${renderInvoice(invoice)}`
}
