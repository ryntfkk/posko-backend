const express = require('express');
const controller = require('./controller');
const { validateCreatePayment } = require('./validators');
const authenticate = require('../../middlewares/auth');

const router = express.Router();

// --- PUBLIC ROUTES (Tanpa Login) ---
router.post('/notification', controller.handleNotification);

// --- PROTECTED ROUTES (Butuh Login) ---
router.use(authenticate);

// [BARU] Route Admin untuk melihat semua pembayaran
router.get('/all', controller.listAllPayments);

router.get('/', controller.listPayments);
router.post('/', validateCreatePayment, controller.createPayment);

module.exports = router;