const express = require('express');
const router = express.Router();
const controller = require('./controller');
const authenticate = require('../../middlewares/auth');

// Mendapatkan list voucher saya (butuh login)
router.get('/', authenticate, controller.listAvailableVouchers);

// Cek voucher valid atau tidak (biasanya dipanggil di checkout)
router.post('/check', authenticate, controller.checkVoucher); 

module.exports = router;