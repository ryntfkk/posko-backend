const mongoose = require('mongoose');

const regionSchema = new mongoose.Schema({
  id: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true 
  },
  name: { 
    type: String, 
    required: true 
  },
  type: { 
    type: String, 
    required: true, 
    enum: ['province', 'regency', 'district', 'village'], // Validasi tipe wilayah
    index: true 
  },
  parentId: { 
    type: String, 
    default: null,
    index: true 
  }
}, {
  timestamps: true // Ini akan menangani createdAt dan updatedAt secara otomatis
});

module.exports = mongoose.model('Region', regionSchema);