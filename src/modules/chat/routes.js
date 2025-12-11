// src/modules/chat/routes.js
const express = require('express');
const controller = require('./controller');
const authenticate = require('../../middlewares/auth');
// [UBAH] Gunakan config S3
const uploadS3 = require('../../config/s3Upload'); 

const router = express.Router();

// Semua route chat wajib login
router.use(authenticate);

// List semua chat room user
router.get('/', controller.listRooms);

// Detail chat room (Message History)
router.get('/:roomId', controller.getChatDetail);

// Mulai chat baru (Create Room)
router.post('/', controller.createRoom); 

// [UBAH] Upload Attachment menggunakan Middleware S3
// Key yang digunakan di frontend biasanya 'file' atau 'image'
router.post('/upload', uploadS3.single('file'), controller.uploadAttachment);

module.exports = router;