const express = require('express');
const router = express.Router();
const voucherController = require('./controller');
const authenticate = require('../../middlewares/auth'); 
const { validateVoucherCheck, validateVoucherClaim } = require('./validators');
const { runValidation } = require('../../middlewares/validator'); 

// 1. [PUBLIC] List Voucher Marketplace (Yang bisa diklaim)
// Bisa diakses tanpa login (opsional) atau dengan login.
// Di sini kita pakai auth agar bisa filter voucher yang SUDAH diklaim user.
router.get('/available', authenticate, voucherController.listAvailableVouchers);

// 2. [PRIVATE] List Voucher Saya (Yang sudah diklaim)
router.get('/my', authenticate, voucherController.listMyVouchers);

// 3. [PRIVATE] Klaim Voucher
router.post('/claim', authenticate, validateVoucherClaim, runValidation, voucherController.claimVoucher);

// 4. [PUBLIC/PRIVATE] Cek Voucher saat Checkout
// Perlu auth karena kita harus cek apakah user ini punya vouchernya di UserVoucher
router.post('/check', authenticate, validateVoucherCheck, runValidation, voucherController.checkVoucher);

module.exports = router;