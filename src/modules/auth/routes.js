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
  limits: { fileSize: 2 * 1024 * 1024 }, // Limit 2MB sesuai frontend
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file gambar yang diperbolehkan!'));
    }
  }
});

// [HELPER] Middleware Kondisional: Hanya jalankan multer jika header multipart
const uploadMiddleware = (req, res, next) => {
  const contentType = req.headers['content-type'];
  if (contentType && contentType.includes('multipart/form-data')) {
    // Gunakan .single('profilePicture') sesuai field name di frontend
    return upload.single('profilePicture')(req, res, next);
  }
  next();
};

const router = express.Router();

// Public routes
router.post('/register', validateRegister, controller.register);
router.post('/login', validateLogin, controller.login);
router.post('/refresh-token', validateRefreshToken, controller.refreshToken); // [NEW]

// Protected routes
router.get('/profile', authenticate, controller.getProfile);
// [FIX] Menambahkan route PUT untuk update profil dengan support upload file
router.put('/profile', authenticate, uploadMiddleware, controller.updateProfile);

router.post('/logout', authenticate, controller.logout); // [NEW]
router.post('/switch-role', authenticate, controller.switchRole);
router.post('/register-partner', authenticate, controller.registerPartner);

module.exports = router;