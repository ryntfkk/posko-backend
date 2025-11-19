const Payment = require('./model');

async function listPayments(req, res, next) {
  try {
    const payments = await Payment.find();
    const messageKey = 'payments.list';
    res.json({ messageKey, message: req.t(messageKey), data: payments });
  } catch (error) {
    next(error);
  }
}

async function createPayment(req, res, next) {
  try {
    const { orderId, amount, method = 'bank_transfer' } = req.body;
    const payment = new Payment({ orderId, amount, method });
    await payment.save();
    const messageKey = 'payments.created';
    res.status(201).json({ messageKey, message: req.t(messageKey), data: payment });
  } catch (error) {
    next(error);
  }
}

module.exports = { listPayments, createPayment };