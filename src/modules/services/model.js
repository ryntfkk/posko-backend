const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema(
  {
    // ===== INFORMASI DASAR =====
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      index: true,
    },
    shortDescription: {
      type: String,
      default: '',
      maxlength: 150, // Untuk preview di card
    },
    description: {
      type: String,
      default: '',
    },
    
    // ===== HARGA & SATUAN =====
    basePrice: {
      type: Number,
      required: true,
      min: 0,
    },
    maxPrice: {
      type: Number,
      default: null, // Jika ada range harga
    },
    unit: {
      type: String,
      required: true,
      default: 'unit',
      enum: ['unit', 'jam', 'hari', 'meter', 'kg', 'paket', 'orang', 'ruangan', 'kendaraan', 'sesi'],
    },
    unitLabel: {
      type: String,
      default: '', // Kustom label: "per unit AC", "per sesi 1 jam"
    },
    priceNote: {
      type: String,
      default: '', // "Harga belum termasuk sparepart"
    },
    
    // ===== PROMO =====
    isPromo: {
      type: Boolean,
      default: false,
    },
    promoPrice: {
      type: Number,
      default: null,
    },
    promoEndDate: {
      type: Date,
      default: null,
    },
    promoLabel: {
      type: String,
      default: '', // "Diskon 20%", "Flash Sale"
    },
    
    // ===== DURASI & KUANTITAS =====
    estimatedDuration: {
      type: Number, // dalam menit
      default: 60,
    },
    minQuantity: {
      type: Number,
      default: 1,
    },
    maxQuantity: {
      type: Number,
      default: 99,
    },
    
    // ===== DETAIL LAYANAN =====
    includes: [{
      type: String, // ["Cuci indoor & outdoor", "Cek freon", "Pembersihan filter"]
    }],
    excludes: [{
      type: String, // ["Sparepart", "Isi freon", "Perbaikan besar"]
    }],
    requirements: [{
      type: String, // ["Listrik menyala", "Akses ke unit AC mudah"]
    }],
    
    // ===== MEDIA =====
    iconUrl: {
      type: String,
      default: '',
    },
    thumbnailUrl: {
      type: String,
      default: '',
    },
    images: [{
      type: String, // Array of image URLs
    }],
    videoUrl: {
      type: String,
      default: '',
    },
    
    // ===== SEO & PENCARIAN =====
    tags: [{
      type: String,
      lowercase: true,
    }],
    keywords: [{
      type: String,
    }],
    
    // ===== STATISTIK (Auto-updated) =====
    totalOrders: {
      type: Number,
      default: 0,
    },
    averageRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    reviewCount: {
      type: Number,
      default: 0,
    },
    popularityScore: {
      type: Number,
      default: 0, // Dihitung dari orders + rating + views
    },
    
    // ===== KONFIGURASI BISNIS =====
    commissionPercent: {
      type: Number,
      default: 15, // Komisi platform 15%
      min: 0,
      max: 100,
    },
    isFeatured: {
      type: Boolean,
      default: false, // Tampil di halaman utama
    },
    sortOrder: {
      type: Number,
      default: 0, // Untuk custom sorting
    },
    
    // ===== AVAILABILITY =====
    isActive: {
      type: Boolean,
      default: true,
    },
    availableDays: {
      type: [Number], // 0=Minggu, 1=Senin, dst
      default: [1, 2, 3, 4, 5, 6], // Senin-Sabtu
    },
    availableHours: {
      start: { type: String, default: '08:00' },
      end: { type: String, default: '18:00' },
    },
    needsAppointment: {
      type: Boolean,
      default: true,
    },
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// ===== VIRTUALS =====

// Harga yang ditampilkan (promo atau normal)
serviceSchema.virtual('displayPrice').get(function() {
  if (this.isPromo && this.promoPrice && this.promoEndDate > new Date()) {
    return this.promoPrice;
  }
  return this.basePrice;
});

// Label satuan
serviceSchema. virtual('displayUnit').get(function() {
  if (this.unitLabel) return this.unitLabel;
  
  const unitLabels = {
    'unit': 'per unit',
    'jam': 'per jam',
    'hari': 'per hari',
    'meter': 'per meter',
    'kg': 'per kg',
    'paket': 'per paket',
    'orang': 'per orang',
    'ruangan': 'per ruangan',
    'kendaraan': 'per kendaraan',
    'sesi': 'per sesi'
  };
  
  return unitLabels[this.unit] || 'per unit';
});

// Format harga untuk display
serviceSchema.virtual('priceDisplay').get(function() {
  const formatter = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0
  });
  
  if (this. maxPrice && this.maxPrice > this.basePrice) {
    return `${formatter.format(this. basePrice)} - ${formatter.format(this. maxPrice)}`;
  }
  return formatter.format(this. displayPrice);
});

// Estimasi durasi dalam format readable
serviceSchema.virtual('durationDisplay').get(function() {
  const mins = this.estimatedDuration;
  if (mins < 60) return `${mins} menit`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (remainMins === 0) return `${hours} jam`;
  return `${hours} jam ${remainMins} menit`;
});

// Diskon percentage
serviceSchema.virtual('discountPercent').get(function() {
  if (! this.isPromo || !this.promoPrice) return 0;
  return Math.round((1 - this.promoPrice / this.basePrice) * 100);
});

// ===== INDEXES =====
serviceSchema.index({ slug: 1 });
serviceSchema.index({ category: 1, isActive: 1 });
serviceSchema. index({ tags: 1 });
serviceSchema.index({ isFeatured: 1, sortOrder: 1 });
serviceSchema.index({ popularityScore: -1 });
serviceSchema.index({ '$**': 'text' }); // Full-text search

// ===== PRE-SAVE HOOKS =====
serviceSchema.pre('save', function(next) {
  // Auto-generate slug dari name
  if (!this.slug || this.isModified('name')) {
    this.slug = this. name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
  next();
});

const Service = mongoose.model('Service', serviceSchema);

module.exports = Service;