const express = require('express');
const router = express.Router();
const upload = require('../../config/s3Upload');
const { uploadImage } = require('./controller');
const requireDbConnection = require('../../middlewares/dbHealth');
const { isAuthenticated, requireAdmin } = require('../../middlewares/auth');

// Endpoint: POST /api/upload
// Route ini akan dimount di /api/upload pada index.js, jadi di sini cukup '/'
// Middleware urutannya:
// 1. isAuthenticated: Pastikan user login
// 2. upload.single('image'): Proses multipart/form-data dan upload ke S3
// 3. uploadImage: Controller untuk mengembalikan URL ke frontend

router.post(
  '/', 
  isAuthenticated, 
  upload.single('image'), 
  uploadImage
);

module.exports = router;