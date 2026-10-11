use crate::price::format_price;

pub fn price_label(amount: f64) -> String {
    format!("Price: {}", format_price(amount))
}
