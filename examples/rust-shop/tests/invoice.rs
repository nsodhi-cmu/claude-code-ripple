use rust_shop::invoice::{render_invoice, Invoice, Line};

fn line(description: &str, amount: f64) -> Line {
    Line {
        description: description.to_string(),
        amount,
    }
}

#[test]
fn renders_invoice_total() {
    let invoice = Invoice {
        id: "INV-1".to_string(),
        lines: vec![line("Design", 120.0), line("Hosting", 19.5)],
        currency: "USD".to_string(),
    };
    assert_eq!(render_invoice(&invoice), "Invoice INV-1: $139.50");
}
