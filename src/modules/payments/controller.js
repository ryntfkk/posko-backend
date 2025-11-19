const Payment = require('./model');

async function listPayments(req, res, next) {
  try {
    const payments = await Payment.find();
    res.json({ message: 'Daftar pembayaran', data: payments });
  } catch (error) {
    next(error);
  }
}

async function createPayment(req, res, next) {
  try {
    const { orderId, amount, method = 'bank_transfer' } = req.body;
    const payment = new Payment({ orderId, amount, method });
    await payment.save();
    res.status(201).json({ message: 'Pembayaran tercatat', data: payment });
  } catch (error) {
    next(error);
  }
}

module.exports = { listPayments, createPayment };