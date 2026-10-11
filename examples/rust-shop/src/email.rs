use crate::price::format_price;

pub struct Receipt {
    pub to: String,
    pub total: f64,
    pub currency: String,
}

pub fn email_receipt(receipt: &Receipt) -> String {
    let total = format_price(receipt.total);
    format!("To: {}\nThanks! You paid {}.", receipt.to, total)
}
