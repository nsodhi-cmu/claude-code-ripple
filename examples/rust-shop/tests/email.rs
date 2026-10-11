use rust_shop::email::{email_receipt, Receipt};

#[test]
fn emails_a_receipt() {
    let receipt = Receipt {
        to: "ada@example.com".to_string(),
        total: 30.0,
        currency: "USD".to_string(),
    };
    let expected = "To: ada@example.com\nThanks! You paid $30.00.";
    assert_eq!(email_receipt(&receipt), expected);
}
