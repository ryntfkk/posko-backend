const mongoose = require('mongoose');

const voucherSchema = new mongoose.Schema({
  code: { 
    type: String, 
    required: true, 
    unique: true, 
    uppercase: true,
    trim: true
  },
  description: { 
    type: String, 
    default: '' 
  },
  discountType: { 
    type: String, 
    enum: ['percentage', 'fixed'], 
    required: true 
  },
  discountValue: { 
    type: Number, 
    required: true 
  }, // Bisa nominal (Rp) atau persentase (%)
  maxDiscount: { 
    type: Number, 
    default: 0 
  }, // 0 = no limit (berguna jika tipe percentage)
  minPurchase: { 
    type: Number, 
    default: 0 
  },
  expiryDate: { 
    type: Date, 
    required: true 
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  quota: { 
    type: Number, 
    default: 0 
  },
  // [BARU] Field untuk membatasi layanan spesifik
  // Jika array kosong [] = Berlaku untuk SEMUA layanan
  // Jika terisi = Hanya berlaku untuk Service ID yang ada di list
  applicableServices: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service'
  }]
}, { timestamps: true });

module.exports = mongoose.model('Voucher', voucherSchema);