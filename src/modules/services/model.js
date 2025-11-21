const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true, // Contoh: "Cuci AC 0.5 - 1 PK"
      trim: true,
    },
    category: {
      type: String,
      required: true, // Contoh: "AC", "Cleaning", "Elektronik"
      index: true, // Supaya pencarian kategori cepat
    },
    iconUrl: {
      type: String,
      default: '', // Link gambar ikon layanan
    },
    basePrice: {
      type: Number,
      required: true, // Harga standar aplikasi (untuk Basic Order)
      min: 0,
    },
    description: {
      type: String,
      default: '', // Penjelasan detail layanan
    },
    isActive: {
      type: Boolean,
      default: true, // Admin bisa menyembunyikan layanan ini jika perlu
    },
  },
  { timestamps: true }
);

const Service = mongoose.model('Service', serviceSchema);

module.exports = Service;