import type { RippleMap, RippleNode } from '../types'

const node = (
  name: string,
  file: string,
  line: number,
  rest: Partial<RippleNode> = {},
): RippleNode => ({
  id: `${file}:${name}`,
  name,
  kind: 'function',
  file,
  line,
  role: 'dependent',
  depth: 1,
  risk: 'ok',
  isTested: true,
  ...rest,
})

/**
 * A shop after `formatPrice` gained a currency parameter: four functions use
 * it, each in a file of its own, two pages use two of those, and it uses two
 * helpers that share a file.
 */
export const SHOP_MAP: RippleMap = {
  method: 'lsp',
  summary: 'Two callers of formatPrice no longer compile, and receipts may show the wrong currency.',
  scope: 'uncommitted',
  base: 'HEAD',
  focus: '',
  print: '',
  nodes: [
    node('formatPrice', 'src/price.ts', 1, {
      role: 'changed',
      depth: 0,
      change: 'signature',
      reason: 'gained a required currency parameter',
    }),
    node('renderCart', 'src/cart.ts', 14, {
      risk: 'breaks',
      isTested: false,
      reason: 'passes 1 argument; formatPrice now takes 2',
    }),
    node('renderInvoice', 'src/invoice.ts', 11, {
      risk: 'breaks',
      reason: 'passes 1 argument; invoice.currency is not passed',
    }),
    node('priceLabel', 'src/ui.ts', 4),
    node('emailReceipt', 'src/email.ts', 6, {
      risk: 'review',
      reason: 'passes a hard-coded "USD"; receipts in other currencies show the wrong symbol',
    }),
    node('CheckoutPage', 'src/pages/checkout.ts', 5, { depth: 2 }),
    node('InvoicePage', 'src/pages/invoice.ts', 5, { depth: 2 }),
    node('toFixed2', 'src/money.ts', 9, { role: 'dependency' }),
    node('currencySymbol', 'src/money.ts', 3, { role: 'dependency' }),
  ],
  edges: [
    { from: 'src/cart.ts:renderCart', to: 'src/price.ts:formatPrice' },
    { from: 'src/invoice.ts:renderInvoice', to: 'src/price.ts:formatPrice' },
    { from: 'src/ui.ts:priceLabel', to: 'src/price.ts:formatPrice' },
    { from: 'src/email.ts:emailReceipt', to: 'src/price.ts:formatPrice' },
    { from: 'src/pages/checkout.ts:CheckoutPage', to: 'src/cart.ts:renderCart' },
    { from: 'src/pages/invoice.ts:InvoicePage', to: 'src/invoice.ts:renderInvoice' },
    { from: 'src/price.ts:formatPrice', to: 'src/money.ts:toFixed2' },
    { from: 'src/price.ts:formatPrice', to: 'src/money.ts:currencySymbol' },
  ],
}

/** The shop's map as a mapper would report it: no depths, and no word of which changes it is of. */
export const SHOP_REPORT = {
  method: SHOP_MAP.method,
  summary: SHOP_MAP.summary,
  nodes: SHOP_MAP.nodes.map(({ depth: _depth, ...reported }) => reported),
  edges: SHOP_MAP.edges,
}
