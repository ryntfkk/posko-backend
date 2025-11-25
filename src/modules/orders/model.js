const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  name: { type: String, required: true },
  quantity: { type: Number, default: 1 },
  price: { type: Number, required: true },
  note: { type: String }
});

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
    items: [orderItemSchema],
    status: {
      type: String,
      enum: ['pending', 'paid', 'searching', 'accepted', 'on_the_way', 'working', 'waiting_approval', 'completed', 'cancelled', 'failed'],
      default: 'pending',
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    // Tanggal Kunjungan Wajib Diisi
    scheduledAt: {
      type: Date,
      required: [true, 'Tanggal kunjungan (scheduledAt) wajib diisi'],
      index: true
    },
    // --- [UPDATE BARU] Simpan Alamat dan Lokasi dari Request Frontend ---
    shippingAddress: {
      province: { type: String },
      district: { type: String },
      city: { type: String },
      village: { type: String },
      postalCode: { type: String },
      detail: { type: String },
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        default: [0, 0],
      },
    },
    // -----------------------------------------------------------------------
    rejectedByProviders: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Provider' 
    }],
    paymentId: { type: String },
    snapToken: { type: String }
  },
  { timestamps: true }
);

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;