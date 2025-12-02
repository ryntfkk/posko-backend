const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  key: { 
    type: String, 
    required: true, 
    unique: true, 
    default: 'global_config' 
  },
  adminFee: { 
    type: Number, 
    default: 0 
  },
  platformCommissionPercent: {
    type: Number,
    default: 12,
    min: [0, 'Komisi platform tidak boleh negatif'],
    max: [100, 'Komisi platform tidak boleh lebih dari 100%']
  },
  currency: { 
    type: String, 
    default: 'IDR' 
  },
  isActive: { 
    type: Boolean, 
    default: true 
  }
}, { timestamps: true });

module.exports = mongoose.model('Settings', settingsSchema);