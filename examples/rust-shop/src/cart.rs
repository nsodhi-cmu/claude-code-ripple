use crate::price::format_price;

pub struct Item {
    pub name: String,
    pub price: f64,
    pub qty: u32,
}

pub struct Cart {
    pub items: Vec<Item>,
    pub currency: String,
}

pub fn render_cart(cart: &Cart) -> String {
    let mut total = 0.0;
    let mut lines = Vec::new();
    for item in &cart.items {
        let line_total = item.price * f64::from(item.qty);
        total += line_total;
        let price = format_price(line_total);
        lines.push(format!("{} x {}: {}", item.qty, item.name, price));
    }
    lines.push(format!("Total: {}", format_price(total)));
    lines.join("\n")
}
