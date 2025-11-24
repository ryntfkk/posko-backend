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
    // Format penyimpanan di MongoDB: ISODate("2024-12-25T00:00:00.000Z")
    blockedDates: {
      type: [Date],
      default: [],
      index: true
    }
  },
  { timestamps: true }
);

const Provider = mongoose.model('Provider', providerSchema);

module.exports = Provider;