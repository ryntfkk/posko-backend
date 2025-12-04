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
    // Daftar Tanggal Libur / Tidak Tersedia (Manual Block)
    blockedDates: {
      type: [Date],
      default: [],
      index: true
    },
    // Portfolio/Dokumentasi - Gambar hasil kerja mitra
    portfolioImages: {
      type: [String], // Array of image URLs
      default: [],
    },
    // Total pesanan selesai untuk statistik
    totalCompletedOrders: {
      type: Number,
      default: 0,
    },
    // Status Verifikasi Mitra
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected', 'suspended'],
      default: 'pending',
      index: true
    },
    // [BARU] Informasi Personal Mendalam
    personalInfo: {
      nik: { type: String, default: '' },
      dateOfBirth: { type: Date },
      gender: { type: String, enum: ['Laki-laki', 'Perempuan'], default: 'Laki-laki' }
    },
    // [BARU] Alamat Domisili (Bisa beda dengan KTP)
    domicileAddress: {
      type: String,
      default: ''
    },
    // [BARU] Informasi Rekening Bank (Untuk Pencairan Dana)
    bankAccount: {
      bankName: { type: String, default: '' },
      accountNumber: { type: String, default: '' },
      accountHolderName: { type: String, default: '' }
    },
    // [BARU] Kontak Darurat
    emergencyContact: {
      name: { type: String, default: '' },
      relationship: { type: String, default: '' },
      phoneNumber: { type: String, default: '' }
    },
    // Dokumen Pendukung
    documents: {
      ktpUrl: { type: String, default: '' },
      selfieKtpUrl: { type: String, default: '' },
      skckUrl: { type: String, default: '' },
      certificateUrl: { type: String, default: '' }
    },
    // Detail Tambahan
    details: {
      experienceYears: { type: Number, default: 0 },
      description: { type: String, default: '' }, // Bio profesional / keahlian
      serviceCategory: { type: String, default: '' }, // Kategori utama
      vehicleType: { type: String, default: '' } // Jenis kendaraan (jika ada)
    },
    // Alasan Penolakan (Jika rejected)
    rejectionReason: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

const Provider = mongoose.model('Provider', providerSchema);

module.exports = Provider;