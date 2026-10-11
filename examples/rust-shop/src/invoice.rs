use crate::price::format_price;

pub struct Line {
    pub description: String,
    pub amount: f64,
}

pub struct Invoice {
    pub id: String,
    pub lines: Vec<Line>,
    pub currency: String,
}

pub fn render_invoice(invoice: &Invoice) -> String {
    let total: f64 = invoice.lines.iter().map(|line| line.amount).sum();
    format!("Invoice {}: {}", invoice.id, format_price(total))
}
