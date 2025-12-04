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
      enum: ['bank_transfer', 'credit_card', 'cash', 'midtrans_snap'],
      default: 'bank_transfer',
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed'],
      default: 'pending',
    },
    // [NEW] Transaction Type: Membedakan pembayaran awal vs add-on
    transactionType: {
      type: String,
      enum: ['initial', 'additional_fee'],
      default: 'initial'
    },
    // [NEW] Reference to Additional Fee ID (jika transactionType === 'additional_fee')
    feeId: {
      type: String, // Simpan string ID subdocument additionalFees
      default: null
    }
  },
  { timestamps: true }
);

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = Payment;