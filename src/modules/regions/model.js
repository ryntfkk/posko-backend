// src/modules/regions/model.js
const mongoose = require('mongoose');

const regionSchema = new mongoose.Schema({
  id: { type: String, required: true, index: true }, // ID Wilayah (contoh: 35 untuk Jatim)
  name: { type: String, required: true },            // Nama Wilayah
  type: { 
    type: String, 
    enum: ['province', 'regency', 'district', 'village'], 
    required: true 
  },
  parentId: { type: String, index: true, default: null } // ID Induk (Kota induknya Provinsi, dst)
}, { timestamps: true });

// Indexing agar pencarian cepat
regionSchema.index({ type: 1, parentId: 1 });

const Region = mongoose.model('Region', regionSchema);

module.exports = Region;