// src/modules/upload/routes.js
const express = require('express');
const router = express.Router();
const upload = require('../../config/s3Upload');
const { uploadImage } = require('./controller');
const requireDbConnection = require('../../middlewares/dbHealth');
const { isAuthenticated, requireAdmin } = require('../../middlewares/auth');

// Endpoint: POST /api/upload
// Menggunakan middleware 'upload.single' untuk menangani satu file bernama 'image'
// Menambahkan requireDbConnection (optional, tapi baik untuk konsistensi health check)
// Menambahkan isAuthenticated agar tidak sembarang orang bisa upload (optional, sesuaikan kebutuhan)

router.post(
  '/', 
  isAuthenticated, // Hanya user login yang bisa upload (Keamanan)
  upload.single('image'), 
  uploadImage
);

module.exports = router;