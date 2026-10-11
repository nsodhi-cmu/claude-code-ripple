use rust_shop::ui::price_label;

#[test]
fn labels_a_price() {
    assert_eq!(price_label(12.5), "Price: $12.50");
    assert_eq!(price_label(0.0), "Price: $0.00");
}
