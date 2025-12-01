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