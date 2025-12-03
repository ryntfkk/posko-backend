const mongoose = require('mongoose');

const earningsSchema = new mongoose.Schema({
  providerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Provider',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
    unique: true,
    index: true
  },
  totalAmount: {
    type: Number,
    required: true
  },
  // [BARU] Field untuk mencatat total biaya tambahan yang dibayar
  additionalFeeAmount: {
    type: Number,
    default: 0
  },
  adminFee: {
    type: Number,
    required: true
  },
  platformCommissionPercent: {
    type: Number,
    required: true
  },
  platformCommissionAmount: {
    type: Number,
    required: true
  },
  earningsAmount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'paid_out'],
    default: 'pending'
  },
  completedAt: {
    type: Date,
    default: null
  },
  paidOutAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model('Earnings', earningsSchema);