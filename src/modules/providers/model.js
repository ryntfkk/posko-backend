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
    // Status Online/Offline untuk menerima orderan
    isOnline: {
      type: Boolean,
      default: false, 
    },
    // [FITUR BARU] Jadwal Operasional
    schedule: [
      {
        dayIndex: { type: Number, required: true }, // 0 = Minggu, 6 = Sabtu
        dayName: { type: String, required: true },  // "Senin", "Selasa", dll
        isOpen: { type: Boolean, default: true },
        start: { type: String, default: '09:00' },  // Format HH:mm
        end: { type: String, default: '17:00' }     // Format HH:mm
      }
    ]
  },
  { timestamps: true }
);

const Provider = mongoose.model('Provider', providerSchema);

module.exports = Provider;