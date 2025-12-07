const mongoose = require('mongoose');

const payoutRequestSchema = new mongoose.Schema({
  providerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Provider',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 10000 // Minimal pencairan misal Rp 10.000
  },
  bankSnapshot: { // Snapshot data bank saat request dibuat (agar aman jika user ubah profil nanti)
    bankName: String,
    accountNumber: String,
    accountHolderName: String
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true
  },
  adminNote: { // Catatan dari admin jika reject atau info transfer
    type: String,
    default: ''
  },
  processedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model('PayoutRequest', payoutRequestSchema);