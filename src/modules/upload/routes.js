// src/modules/upload/routes.js
const express = require('express');
const router = express.Router();
const uploadS3 = require('../../config/3Upload'); 
const { uploadImage } = require('./controller');
const authenticate = require('../../middlewares/auth');
const requireDbConnection = require('../../middlewares/dbHealth');

// Endpoint: POST /api/upload
// Menggunakan middleware 'image' sesuai key yang dikirim frontend (FormData)
router.post(
  '/', 
  requireDbConnection, // Cek kesehatan DB dulu
  authenticate,        // Wajib login
  uploadS3.single('image'), 
  uploadImage
);

module.exports = router;