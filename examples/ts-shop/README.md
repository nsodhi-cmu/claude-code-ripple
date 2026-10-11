# ts-shop

A tiny TypeScript fixture for the Ripple demo: one price formatter, four direct callers, two pages on top.

    CheckoutPage -> renderCart ----+
    InvoicePage  -> renderInvoice -+-> formatPrice -> toFixed2, currencySymbol
                    priceLabel ----+
                    emailReceipt --+

Type-check with `npm run check`. Every direct caller has a test in `tests/` except `renderCart`.

Demo prompt: `Add a currency parameter to formatPrice. Only edit src/price.ts.`
