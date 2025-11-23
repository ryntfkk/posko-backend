const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
    },
    orderType: {
      type: String,
      enum: ['direct', 'basic'],
      required: true,
      default: 'basic'
    },
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Provider',
      default: null,
    },
    // [UBAH DISINI] Struktur items diperkaya
    items: [
      {
        serviceId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Service',
          required: true // Wajib ada ID layanannya
        },
        name: { 
          type: String, 
          required: true 
        },
        quantity: { 
          type: Number, 
          required: true, 
          min: 1 
        },
        price: { 
          type: Number, 
          required: true // Harga per item saat deal
        },
        note: {
          type: String,
          default: ''
        }
      },
    ],
    status: {
      type: String,
      // [UPDATE] Menambahkan 'waiting_approval'
      enum: ['pending', 'paid', 'searching', 'accepted', 'on_the_way', 'working', 'waiting_approval', 'completed', 'cancelled'],
      default: 'pending',
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    rejectedByProviders: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Provider' 
    }],
  },
  { timestamps: true }
);

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;