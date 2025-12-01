const mongoose = require('mongoose');

const userVoucherSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  voucherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Voucher',
    required: true
  },
  claimedAt: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['active', 'used'], // 'active' = sudah klaim tapi belum dipakai, 'used' = sudah dipakai
    default: 'active'
  },
  usageDate: {
    type: Date,
    default: null
  },
  // Opsional: Untuk mencatat voucher ini dipakai di order nomor berapa
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    default: null
  }
}, { timestamps: true });

// Index Unique: Mencegah user mengklaim voucher yang sama lebih dari 1 kali
userVoucherSchema.index({ userId: 1, voucherId: 1 }, { unique: true });

module.exports = mongoose.model('UserVoucher', userVoucherSchema);