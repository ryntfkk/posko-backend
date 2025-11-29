const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      index: true,
    },
    iconUrl: {
      type: String,
      default: '',
    },
    basePrice: {
      type: Number,
      required: true,
      min: 0,
    },
    // ✅ [BARU] Satuan layanan
    unit: {
      type: String,
      required: true,
      default: 'unit',
      enum: ['unit', 'jam', 'hari', 'meter', 'kg', 'paket', 'orang', 'ruangan', 'kendaraan'],
      // unit = per unit (AC, kulkas, dll)
      // jam = per jam (pijat, les, dll)  
      // hari = per hari (sewa alat, dll)
      // meter = per meter (kabel, pipa, dll)
      // kg = per kilogram (laundry, dll)
      // paket = per paket (cleaning rumah, dll)
      // orang = per orang (catering, dll)
      // ruangan = per ruangan (cleaning kamar, dll)
      // kendaraan = per kendaraan (cuci mobil/motor)
    },
    // ✅ [BARU] Label satuan yang ditampilkan (opsional, untuk kustomisasi)
    unitLabel: {
      type: String,
      default: '', // Jika kosong, gunakan default dari unit
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Virtual untuk mendapatkan label satuan
serviceSchema. virtual('displayUnit').get(function() {
  if (this.unitLabel) return this. unitLabel;
  
  const unitLabels = {
    'unit': 'per unit',
    'jam': 'per jam',
    'hari': 'per hari',
    'meter': 'per meter',
    'kg': 'per kg',
    'paket': 'per paket',
    'orang': 'per orang',
    'ruangan': 'per ruangan',
    'kendaraan': 'per kendaraan'
  };
  
  return unitLabels[this.unit] || 'per unit';
});

// Pastikan virtual diinclude saat toJSON
serviceSchema.set('toJSON', { virtuals: true });
serviceSchema.set('toObject', { virtuals: true });

const Service = mongoose.model('Service', serviceSchema);

module.exports = Service;