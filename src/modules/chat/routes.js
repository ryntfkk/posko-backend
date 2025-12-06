// src/modules/chat/routes.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const controller = require('./controller');
const authenticate = require('../../middlewares/auth');

const router = express.Router();

// --- KONFIGURASI MULTER (UPLOAD) ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Pastikan folder 'public/uploads' ada
    cb(null, 'public/uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'chat-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Limit 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file gambar yang diperbolehkan!'));
    }
  }
});

// Semua route chat wajib login
router.use(authenticate);

// List semua chat room user
router.get('/', controller.listRooms);

// Detail chat room (Message History)
router.get('/:roomId', controller.getChatDetail);

// Mulai chat baru (Create Room)
router.post('/', controller.createRoom); 

// [BARU] Upload Attachment
router.post('/upload', upload.single('file'), controller.uploadAttachment);

module.exports = router;