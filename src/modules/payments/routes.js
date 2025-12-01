const express = require('express');
const controller = require('./controller');
const { validateCreatePayment } = require('./validators');
const authenticate = require('../../middlewares/auth');

const router = express.Router();

// [FIXED] Tambahkan authentication middleware untuk semua payment routes
router.use(authenticate);

router.get('/', controller.listPayments);
router.post('/', validateCreatePayment, controller.createPayment);
router.post('/notification', controller.handleNotification);

module.exports = router;