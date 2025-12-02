const express = require('express');
const router = express.Router();
const voucherController = require('./controller');
const authenticate = require('../../middlewares/auth'); 
const { validateVoucherCheck, validateVoucherClaim } = require('./validators');
const { runValidation } = require('../../middlewares/validator'); 

// 1. [PUBLIC] List Voucher Marketplace (Yang bisa diklaim)
// [UPDATE] Middleware 'authenticate' DIHAPUS agar Guest bisa lihat voucher.
// Controller 'listAvailableVouchers' sekarang menangani cek token secara manual.
router.get('/available', voucherController.listAvailableVouchers);

// 2. [PRIVATE] List Voucher Saya (Yang sudah diklaim)
router.get('/my', authenticate, voucherController.listMyVouchers);

// 3. [PRIVATE] Klaim Voucher
router.post('/claim', authenticate, validateVoucherClaim, runValidation, voucherController.claimVoucher);

// 4. [PUBLIC/PRIVATE] Cek Voucher saat Checkout
// Perlu auth karena kita harus cek apakah user ini punya vouchernya di UserVoucher
router.post('/check', authenticate, validateVoucherCheck, runValidation, voucherController.checkVoucher);

module.exports = router;