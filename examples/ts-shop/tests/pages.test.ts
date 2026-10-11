import { CheckoutPage } from '../src/pages/checkout'
import { InvoicePage } from '../src/pages/invoice'
import { assertEqual } from './assert'

assertEqual(
  CheckoutPage({
    items: [
      { name: 'Mug', price: 12.5, qty: 2 },
      { name: 'Pen', price: 1.25, qty: 4 },
    ],
    currency: 'USD',
  }),
  '# Checkout\n2 x Mug: $25.00\n4 x Pen: $5.00\nTotal: $30.00',
  'CheckoutPage',
)

assertEqual(
  InvoicePage({
    id: 'INV-2',
    lines: [{ description: 'Design', amount: 120 }],
    currency: 'USD',
  }),
  '# Invoice\nInvoice INV-2: $120.00',
  'InvoicePage',
)
