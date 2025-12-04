const express = require('express');
const controller = require('./controller');
const { validateLogin, validateRegister, validateRefreshToken } = require('./validators');
const authenticate = require('../../middlewares/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// [SETUP] Multer untuk Upload Gambar
// Pastikan folder 'public/uploads' ada, atau buat jika belum ada
const uploadDir = 'public/uploads';
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Penamaan file: fieldname-timestamp-random.ext
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Limit naik ke 5MB untuk dokumen
  fileFilter: (req, file, cb) => {
    // Izinkan gambar dan PDF
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Hanya file gambar dan PDF yang diperbolehkan!'));
    }
  }
});

// [HELPER] Middleware Kondisional: Hanya jalankan multer jika header multipart
const uploadProfileMiddleware = (req, res, next) => {
  const contentType = req.headers['content-type'];
  if (contentType && contentType.includes('multipart/form-data')) {
    // Gunakan .single('profilePicture') sesuai field name di frontend
    return upload.single('profilePicture')(req, res, next);
  }
  next();
};

// [BARU] Middleware Upload Dokumen Mitra (Multiple Fields)
const uploadPartnerDocs = upload.fields([
  { name: 'ktp', maxCount: 1 },
  { name: 'selfieKtp', maxCount: 1 },
  { name: 'skck', maxCount: 1 },
  { name: 'certificate', maxCount: 1 }
]);

const router = express.Router();

// Public routes
router.post('/register', validateRegister, controller.register);
router.post('/login', validateLogin, controller.login);
router.post('/refresh-token', validateRefreshToken, controller.refreshToken);

// Protected routes
router.get('/profile', authenticate, controller.getProfile);
// [FIX] Menambahkan route PUT untuk update profil dengan support upload file
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