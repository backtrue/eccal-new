// 直接處理付款成功事件
const paymentIntentData = {
  id: "pi_2RrIdcYDQY3sAQES1VdZDl7i",
  object: "payment_intent",
  amount: 599000,
  currency: "twd",
  customer: "cus_SmP9EF1etwSLi3",
  status: "succeeded",
  metadata: {
    paymentType: "founders_membership",
    userId: "101017118047810033810"
  }
};

console.log('Processing payment for user:', paymentIntentData.metadata.userId);
console.log('Payment type:', paymentIntentData.metadata.paymentType);
console.log('Amount:', paymentIntentData.amount / 100, paymentIntentData.currency);

// Make HTTP request to our internal handler
fetch('http://localhost:5000/api/stripe/process-payment-internal', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(paymentIntentData)
}).then(response => response.json())
  .then(data => console.log('Payment processed:', data))
  .catch(error => console.error('Error:', error));