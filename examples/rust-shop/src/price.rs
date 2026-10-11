pub fn format_price(amount: f64) -> String {
    format!("{}{}", currency_symbol(), to_fixed2(amount))
}

pub fn to_fixed2(amount: f64) -> String {
    format!("{amount:.2}")
}

pub fn currency_symbol() -> &'static str {
    "$"
}
