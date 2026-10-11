import { renderInvoice } from '../src/invoice'
import { assertEqual } from './assert'

assertEqual(
  renderInvoice({
    id: 'INV-1',
    lines: [
      { description: 'Design', amount: 120 },
      { description: 'Hosting', amount: 19.5 },
    ],
    currency: 'USD',
  }),
  'Invoice INV-1: $139.50',
  'renderInvoice',
)
