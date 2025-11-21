const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
    },
    // [BARU] Tipe Order: 'direct' (pilih orang) atau 'basic' (cari terdekat)
    orderType: {
      type: String,
      enum: ['direct', 'basic'], 
      required: true,
      default: 'basic'
    },
    // [BARU] Layanan apa yang dipesan (Wajib ambil dari Katalog)
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
    },
    // [BARU] Provider bisa kosong dulu kalau 'basic' (karena sistem lagi nyari)
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Provider',
      default: null, 
    },
    // [BARU] Harga kesepakatan (Bisa harga aplikasi atau harga provider)
    agreedPrice: {
      type: Number,
      required: true,
    },
    // Item tambahan (opsional, misal beli freon tambahan)
    items: {
      type: [
        {
          name: String,
          quantity: Number,
          price: Number,
        },
      ],
      default: [],
    },
    status: {
      type: String,
      // 'searching' adalah status baru saat sistem mencari mitra untuk Basic Order
      enum: ['pending', 'searching', 'accepted', 'on_the_way', 'working', 'completed', 'cancelled'],
      default: 'pending',
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    // [BARU] Daftar provider yang menolak order ini (supaya tidak ditawarkan lagi ke mereka)
    rejectedByProviders: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Provider' 
    }],
  },
  { timestamps: true }
);

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;