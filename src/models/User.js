const mongoose = require('mongoose');

// Membuat Skema (Cetakan Data) untuk User
const userSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true, // Wajib diisi
  },
  email: {
    type: String,
    required: true,
    unique: true,   // Tidak boleh ada email kembar
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
    // Nanti di sini kita simpan password yang sudah di-acak (hash), bukan teks biasa [19]
  },
   address: {
    province: {
      type: String,
      default: '',
      trim: true,
    },
    district: {
      type: String,
      default: '',
      trim: true,
    },
    city: {
      type: String,
      default: '',
      trim: true,
    },
    detail: {
      type: String,
      default: '',
      trim: true,
    },
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
      validate: {
        validator: (coords) => Array.isArray(coords) && coords.length === 2,
        message: 'Coordinates harus berupa [longitude, latitude]',
      },
    },
  },
  roles: {
    type: [String], // Bisa punya banyak peran, misal: ["customer", "provider"]
    default: ['customer'], // Saat daftar, otomatis jadi customer dulu [114]
    enum: ['customer', 'provider', 'admin'], // Hanya boleh isi ini
  },
  activeRole: {
    type: String,
    default: 'customer', // Peran yang sedang aktif saat login
    enum: ['customer', 'provider', 'admin'],
    validate: {
      validator: function (role) {
        return this.roles.includes(role);
      },
      message: 'activeRole harus salah satu dari roles user',
    },
  },
  profilePictureUrl: {
    type: String,
    default: '', // Boleh kosong
  },
  bannerPictureUrl: {
    type: String,
    default: '',
  },
  bio: {
    type: String,
    default: '',
    trim: true,
    maxlength: [500, 'Bio maksimal 500 karakter'],
  },
  birthDate: {
    type: Date,
    validate: {
      validator: (value) => !value || value <= new Date(),
      message: 'Tanggal lahir tidak boleh di masa depan',
    },
  },
  phoneNumber: {
    type: String,
    default: '',
    trim: true,
    match: [/^\+?[0-9]{10,15}$/, 'Nomor telepon harus 10-15 digit dan boleh diawali +'],
  },
  balance: {
    type: Number,
    default: 0,
    min: [0, 'Saldo tidak boleh negatif'],
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active',
  },
  // Menyimpan kapan data dibuat (createdAt) dan diupdate (updatedAt) secara otomatis
}, { timestamps: true });

userSchema.index({ location: '2dsphere' });

// Membuat Model dari Skema di atas
const User = mongoose.model('User', userSchema);

module.exports = User;