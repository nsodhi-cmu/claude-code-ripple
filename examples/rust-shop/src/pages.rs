use crate::cart::{render_cart, Cart};
use crate::invoice::{render_invoice, Invoice};

pub fn checkout_page(cart: &Cart) -> String {
    format!("# Checkout\n{}", render_cart(cart))
}

pub fn invoice_page(invoice: &Invoice) -> String {
    format!("# Invoice\n{}", render_invoice(invoice))
}
