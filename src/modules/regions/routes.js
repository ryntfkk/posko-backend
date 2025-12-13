const express = require('express');
const router = express.Router();
const controller = require('./controller');
const { optionalAuth } = require('../../middlewares/optionalAuth'); // Optional: jika ingin diproteksi atau public

// Route: GET /api/regions/provinces
// Mengambil semua provinsi untuk dropdown pertama
router.get('/provinces', controller.getProvinces);

// Route: GET /api/regions/children/:parentId
// Mengambil wilayah anak (Kota/Kecamatan/Kelurahan)
// Contoh penggunaan:
// - Masukkan ID Provinsi -> Dapat Kota
// - Masukkan ID Kota -> Dapat Kecamatan
// - Masukkan ID Kecamatan -> Dapat Kelurahan
router.get('/children/:parentId', controller.getRegionsByParent);

module.exports = router;