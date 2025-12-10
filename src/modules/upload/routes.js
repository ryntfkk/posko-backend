const express = require('express');
const router = express.Router();
// [UBAH] Mengarah ke file konfigurasi S3 yang benar (3Upload.js)
const uploadS3 = require('../../config/3Upload'); 
const { uploadImage } = require('./controller');
// [UBAH] Konsistensi import middleware auth (sama dengan modul auth)
const authenticate = require('../../middlewares/auth');
const requireDbConnection = require('../../middlewares/dbHealth');

// Endpoint: POST /api/upload
// Digunakan untuk upload gambar umum (selain profil/dokumen mitra)
// Menggunakan 'image' sebagai key field form-data
router.post(
  '/', 
  requireDbConnection, // Cek kesehatan DB dulu
  authenticate,        // Wajib login
  uploadS3.single('image'), 
  uploadImage
);

module.exports = router;