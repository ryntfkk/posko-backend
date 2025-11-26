// src/modules/payments/routes.js
const express = require('express');
const controller = require('./controller');
const { validateCreatePayment } = require('./validators');
const validateMidtransSignature = require('../../middlewares/validateMidtransSignature');

const router = express.Router();

router.get('/', controller.listPayments);
router.post('/', validateCreatePayment, controller.createPayment);

// --- [PERBAIKAN] Tambahkan signature validation pada webhook ---
router.post('/notification', validateMidtransSignature, controller.handleNotification);

module.exports = router;