const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    method: {
      type: String,
      enum: ['bank_transfer', 'credit_card', 'cash'],
      default: 'bank_transfer',
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = Payment;