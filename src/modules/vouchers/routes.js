const express = require('express');
const router = express.Router();
const voucherController = require('./controller');
const authenticate = require('../../middlewares/auth'); 
const { validateVoucherCheck, validateVoucherClaim } = require('./validators');
const { runValidation } = require('../../middlewares/validator'); 
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// [SETUP] Multer untuk Upload Gambar Voucher
const uploadDir = 'public/uploads';
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Penamaan file: voucher-timestamp-random.ext
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'voucher-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // Limit 2MB cukup untuk voucher
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file gambar yang diperbolehkan!'));
    }
  }
});

// 1. [PUBLIC] List Voucher Marketplace (Yang bisa diklaim)
// Tanpa middleware authenticate agar guest bisa lihat
router.get('/available', voucherController.listAvailableVouchers);

// 2. [PRIVATE] List Voucher Saya (Yang sudah diklaim)
router.get('/my', authenticate, voucherController.listMyVouchers);

// --- ADMIN ROUTES ---
router.get('/all', authenticate, voucherController.listAllVouchers);

// [UPDATE] Tambahkan middleware upload.single('image')
router.post('/', authenticate, upload.single('image'), voucherController.createVoucher);
router.put('/:id', authenticate, upload.single('image'), voucherController.updateVoucher);

router.delete('/:id', authenticate, voucherController.deleteVoucher);
// --------------------

// 3. [PRIVATE] Klaim Voucher
router.post('/claim', authenticate, validateVoucherClaim, runValidation, voucherController.claimVoucher);

// 4. [PUBLIC/PRIVATE] Cek Voucher saat Checkout
router.post('/check', authenticate, validateVoucherCheck, runValidation, voucherController.checkVoucher);

module.exports = router;