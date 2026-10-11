# rust-shop

A tiny Rust library fixture for the Ripple demo: one price formatter, four direct callers, two pages on top.

    checkout_page -> render_cart ----+
    invoice_page  -> render_invoice -+-> format_price -> to_fixed2, currency_symbol
                     price_label ----+
                     email_receipt --+

Check with `cargo check` and `cargo test`. Every direct caller has a test in `tests/` except `render_cart`.

Demo prompt: `Add a currency parameter to format_price. Only edit src/price.rs.`
