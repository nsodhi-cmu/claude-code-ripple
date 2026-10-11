use rust_shop::cart::{Cart, Item};
use rust_shop::invoice::{Invoice, Line};
use rust_shop::pages::{checkout_page, invoice_page};

fn item(name: &str, price: f64, qty: u32) -> Item {
    let name = name.to_string();
    Item { name, price, qty }
}

#[test]
fn renders_checkout_page() {
    let cart = Cart {
        items: vec![item("Mug", 12.5, 2), item("Pen", 1.25, 4)],
        currency: "USD".to_string(),
    };
    let expected = "# Checkout\n2 x Mug: $25.00\n4 x Pen: $5.00\nTotal: $30.00";
    assert_eq!(checkout_page(&cart), expected);
}

#[test]
fn renders_invoice_page() {
    let design = Line {
        description: "Design".to_string(),
        amount: 120.0,
    };
    let invoice = Invoice {
        id: "INV-2".to_string(),
        lines: vec![design],
        currency: "USD".to_string(),
    };
    let expected = "# Invoice\nInvoice INV-2: $120.00";
    assert_eq!(invoice_page(&invoice), expected);
}
