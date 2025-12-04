const mongoose = require('mongoose');

const providerServiceSchema = new mongoose.Schema({
  serviceId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Service',
    required: true 
  },
  price: { 
    type: Number, 
    required: true 
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  description: {
    type: String,
    default: ''
  }
});

const providerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true
    },
    bio: {
      type: String,
      maxlength: 500
    },
    rating: {
      type: Number,
      default: 0,
      index: true
    },
    reviewCount: {
      type: Number,
      default: 0
    },
    services: [providerServiceSchema],
    
    // [UPDATE] Lokasi untuk Geospatial Query
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        default: [0, 0], // [Longitude, Latitude]
      },
      address: {
        type: String,
        default: ''
      }
    },

    isVerified: {
      type: Boolean,
      default: false
    },
    documents: [{
      type: { type: String }, 
      url: { type: String },
      status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
    }],
    bankAccount: {
      bankName: { type: String },
      accountNumber: { type: String },
      accountHolder: { type: String }
    },
    
    // Konfigurasi Ketersediaan
    isAvailable: {
      type: Boolean,
      default: true // Toggle manual oleh provider (Online/Offline)
    },
    workingHours: {
      start: { type: String, default: '08:00' },
      end: { type: String, default: '17:00' }
    },
    blockedDates: [Date],
    timeZone: { type: String, default: 'Asia/Jakarta' },
    timeZoneOffset: { type: String, default: '+07:00' }
  },
  { timestamps: true }
);

// [CRITICAL] Index Geo-Spatial untuk pencarian jarak ("Show me providers near X")
providerSchema.index({ location: '2dsphere' });

// Index untuk performa query layanan
providerSchema.index({ 'services.serviceId': 1, 'services.isActive': 1 });

const Provider = mongoose.model('Provider', providerSchema);

module.exports = Provider;