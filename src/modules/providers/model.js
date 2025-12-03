const mongoose = require('mongoose');

const providerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Services menyimpan detail harga & referensi ke Katalog
    services: [
      {
        serviceId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Service',
          required: true,
        },
        price: {
          type: Number,
          required: true,
        },
        isActive: {
          type: Boolean,
          default: true,
        },
      },
    ],
    rating: {
      type: Number,
      default: 0,
    },
    // Status Online/Offline global (misal untuk mematikan akun sementara)
    isOnline: {
      type: Boolean,
      default: true,
    },
    // [FITUR BARU] Daftar Tanggal Libur / Tidak Tersedia (Manual Block)
    blockedDates: {
      type: [Date],
      default: [],
      index: true
    },
    // [BARU] Portfolio/Dokumentasi - Gambar hasil kerja mitra
    portfolioImages: {
      type: [String], // Array of image URLs
      default: [],
    },
    // [BARU] Total pesanan selesai untuk statistik
    totalCompletedOrders: {
      type: Number,
      default: 0,
    },
    // [BARU] Status Verifikasi Mitra
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected', 'suspended'],
      default: 'pending',
      index: true
    },
    // [BARU] Dokumen Pendukung
    documents: {
      ktpUrl: { type: String, default: '' },
      selfieKtpUrl: { type: String, default: '' },
      skckUrl: { type: String, default: '' },
      certificateUrl: { type: String, default: '' }
    },
    // [BARU] Detail Tambahan
    details: {
      experienceYears: { type: Number, default: 0 },
      description: { type: String, default: '' }, // Bio profesional / keahlian
      serviceCategory: { type: String, default: '' }, // Kategori utama
      vehicleType: { type: String, default: '' } // Jenis kendaraan (jika ada)
    },
    // [BARU] Alasan Penolakan (Jika rejected)
    rejectionReason: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

const Provider = mongoose.model('Provider', providerSchema);

module.exports = Provider;