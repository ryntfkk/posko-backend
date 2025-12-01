const express = require('express');
const controller = require('./controller');
const { validateCreatePayment } = require('./validators');
const authenticate = require('../../middlewares/auth');

const router = express.Router();

// --- PUBLIC ROUTES (Tanpa Login) ---
// Route notifikasi HARUS diletakkan sebelum authenticate middleware
// karena Midtrans tidak mengirimkan token JWT saat mengirim webhook.
router.post('/notification', controller.handleNotification);

// --- PROTECTED ROUTES (Butuh Login) ---
// Middleware authentication hanya berlaku untuk route di bawah baris ini
// [FIXED] Pindahkan authenticate setelah route notification
router.use(authenticate);

router.get('/', controller.listPayments);
router.post('/', validateCreatePayment, controller.createPayment);

module.exports = router;