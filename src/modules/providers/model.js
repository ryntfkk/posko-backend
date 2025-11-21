const mongoose = require('mongoose');

const providerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // [UBAH DISINI] Services sekarang menyimpan detail harga & referensi ke Katalog
    services: [
      {
        serviceId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Service', // Terhubung ke model Service (Langkah 1)
          required: true,
        },
        price: {
          type: Number,
          required: true, // INI ADALAH RATECARD (Harga khusus si Provider)
        },
        isActive: {
          type: Boolean,
          default: true, // Provider bisa mematikan layanan ini sementara (misal: alat rusak)
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
  },
  { timestamps: true }
);

const Provider = mongoose.model('Provider', providerSchema);

module.exports = Provider;