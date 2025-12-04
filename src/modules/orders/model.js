const mongoose = require('mongoose');

// ============ COUNTER SCHEMA untuk Order Number ============
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
});
const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema);

// ============ ORDER ITEM SCHEMA ============
const orderItemSchema = new mongoose.Schema({
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  name: { type: String, required: true },
  quantity: { type: Number, default: 1 },
  price: { type: Number, required: true },
  note: { type: String }
});

// ============ ATTACHMENT SCHEMA ============
const attachmentSchema = new mongoose.Schema({
  url: { type: String, required: true },
  type: { 
    type: String, 
    enum: ['photo', 'video'], 
    default: 'photo' 
  },
  description: { type: String, default: '' },
  uploadedAt: { type: Date, default: Date.now }
});

// ============ ADDITIONAL FEE SCHEMA (BARU) ============
const additionalFeeSchema = new mongoose.Schema({
  description: { type: String, required: true },
  amount: { type: Number, required: true },
  status: {
    type: String,
    enum: ['pending_approval', 'approved_unpaid', 'paid', 'rejected'],
    default: 'pending_approval'
  },
  paymentId: { type: String, default: null }
});

// ============ MAIN ORDER SCHEMA ============
const orderSchema = new mongoose.Schema(
  {
    // [BARU] Order Number - Human Readable (CRITICAL)
    orderNumber: {
      type: String,
      unique: true
      // [FIXED] 'index: true' dihapus karena 'unique: true' sudah otomatis membuat index
    },
    
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
      index: true
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
      index: true
    },
    
    // [OPTIMIZATION] Snapshot Data Provider (Point 6)
    // Menyimpan info provider saat order dibuat agar query list tidak berat (N+1 problem fix)
    providerSnapshot: {
      fullName: { type: String },
      profilePictureUrl: { type: String },
      phoneNumber: { type: String },
      rating: { type: Number }
    },

    items: [orderItemSchema],
    status: {
      type: String,
      enum: ['pending', 'paid', 'searching', 'accepted', 'on_the_way', 'working', 'waiting_approval', 'completed', 'cancelled', 'failed'],
      default: 'pending',
      index: true
    },
    
    // [NEW] Timestamp khusus untuk memantau stuck orders
    waitingApprovalAt: {
      type: Date,
      default: null
    },
    
    // ============ FINANCIAL DETAILS (UPDATED) ============
    totalAmount: {
      type: Number,
      required: true,
    },
    adminFee: {
      type: Number,
      default: 0
    },
    // [PERBAIKAN] Menyimpan snapshot komisi platform saat order dibuat (Integrity Fix)
    appliedCommissionPercent: {
      type: Number,
      default: null
    },
    voucherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Voucher',
      default: null
    },
    discountAmount: {
      type: Number,
      default: 0
    },
    // =====================================================

    // [BARU] BIAYA TAMBAHAN (ADDITIONAL FEES)
    additionalFees: [additionalFeeSchema],

    scheduledAt: {
      type: Date,
      required: [true, 'Tanggal kunjungan (scheduledAt) wajib diisi'],
      index: true
    },
    
    // [BARU] Preferensi Waktu Kedatangan (MEDIUM)
    scheduledTimeSlot: {
      preferredStart: { type: String, default: '' }, // "09:00"
      preferredEnd: { type: String, default: '' },   // "12:00"
      isFlexible: { type: Boolean, default: true }   // Boleh datang di luar slot? 
    },

    // ============ INFORMASI KONTAK CUSTOMER (CRITICAL) ============
    customerContact: {
      name: { type: String, default: '' },           // Nama penerima (bisa beda dengan user)
      phone: { type: String, required: true },       // Nomor HP utama
      alternatePhone: { type: String, default: '' }  // Nomor cadangan
    },

    // ============ CATATAN/INSTRUKSI KHUSUS (HIGH) ============
    orderNote: {
      type: String,
      maxlength: 500,
      default: ''
    },

    // ============ DETAIL PROPERTI (MEDIUM) ============
    propertyDetails: {
      type: { 
        type: String, 
        enum: ['rumah', 'apartemen', 'kantor', 'ruko', 'kendaraan', 'lainnya', ''],
        default: '' 
      },
      floor: { type: Number, default: null },        // Lantai berapa (apartemen/gedung)
      hasParking: { type: Boolean, default: true },  // Ada tempat parkir? 
      hasElevator: { type: Boolean, default: false }, // Ada lift?
      accessNote: { type: String, default: '' }      // Catatan akses khusus
    },

    // ============ LAMPIRAN/DOKUMENTASI AWAL (HIGH) ============
    attachments: [attachmentSchema],

    // [BARU] DOKUMENTASI PENYELESAIAN PEKERJAAN
    completionEvidence: [attachmentSchema],

    // ============ EXISTING FIELDS ============
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
    rejectedByProviders: [{ 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Provider' 
    }],
    paymentId: { type: String },
    snapToken: { type: String }
  },
  { timestamps: true }
);

// ============ PRE-SAVE MIDDLEWARE untuk Generate Order Number ============
orderSchema.pre('save', async function(next) {
  // Hanya generate orderNumber untuk dokumen baru
  if (this.isNew && !this.orderNumber) {
    try {
      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
      
      // Atomic increment untuk counter harian
      const counter = await Counter.findByIdAndUpdate(
        { _id: `order_${dateStr}` },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      
      // Format: PSK-YYYYMMDD-XXXX (contoh: PSK-20251129-0042)
      const paddedSeq = String(counter.seq).padStart(4, '0');
      this.orderNumber = `PSK-${dateStr}-${paddedSeq}`;
    } catch (error) {
      console.error('Error generating order number:', error);
      // Fallback ke random string jika counter gagal
      this.orderNumber = `PSK-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    }
  }
  next();
});

// ============ INDEXES ============
orderSchema.index({ status: 1, orderType: 1, providerId: 1 });
orderSchema.index({ 'items.serviceId': 1 });
orderSchema.index({ location: '2dsphere' });
// [FIXED] Menghapus duplicate index untuk orderNumber
orderSchema.index({ 'customerContact.phone': 1 });

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;