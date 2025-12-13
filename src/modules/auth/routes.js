const express = require('express');
const controller = require('./controller');
const { validateLogin, validateRegister, validateRefreshToken } = require('./validators');
const authenticate = require('../../middlewares/auth');
// Import konfigurasi upload S3 yang sudah dibuat
const upload = require('../../config/s3Upload');

// [HELPER] Middleware Kondisional: Hanya jalankan multer jika header multipart
const uploadProfileMiddleware = (req, res, next) => {
  const contentType = req.headers['content-type'];
  if (contentType && contentType.includes('multipart/form-data')) {
    // Gunakan .single('profilePicture') sesuai field name di frontend
    // Error handling untuk upload
    return upload.single('profilePicture')(req, res, (err) => {
      if (err) {
        // Handle error multer (misal file terlalu besar atau format salah)
        return res.status(400).json({
          message: 'Gagal mengupload gambar profil',
          error: err.message
        });
      }
      next();
    });
  }
  next();
};

// [BARU] Middleware Upload Dokumen Mitra (Multiple Fields)
// Menggunakan upload.fields dari config S3
const uploadPartnerDocs = (req, res, next) => {
  const uploadFields = upload.fields([
    { name: 'ktp', maxCount: 1 },
    { name: 'selfieKtp', maxCount: 1 },
    { name: 'skck', maxCount: 1 },
    { name: 'certificate', maxCount: 1 }
  ]);

  uploadFields(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        message: 'Gagal mengupload dokumen mitra',
        error: err.message
      });
    }
    next();
  });
};

const router = express.Router();

// Public routes
router.post('/register', validateRegister, controller.register);
router.post('/login', validateLogin, controller.login);
router.post('/refresh-token', validateRefreshToken, controller.refreshToken);

// Protected routes
router.get('/profile', authenticate, controller.getProfile);

// [FIX] Menambahkan route PUT untuk update profil dengan support upload file S3
router.put('/profile', authenticate, uploadProfileMiddleware, controller.updateProfile);

router.post('/logout', authenticate, controller.logout);
router.post('/switch-role', authenticate, controller.switchRole);

// [UPDATE] Gunakan middleware uploadPartnerDocs untuk pendaftaran mitra
router.post('/register-partner', authenticate, uploadPartnerDocs, controller.registerPartner);

// [BARU] Admin Routes untuk Manajemen User
router.get('/users', authenticate, controller.listAllUsers);
router.patch('/users/:id/status', authenticate, controller.toggleUserStatus);
// [BARU] Endpoint Edit User oleh Admin
router.put('/users/:id', authenticate, controller.updateUserByAdmin);

module.exports = router;