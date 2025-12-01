const { body } = require('express-validator');

const validateVoucherCheck = [
  body('code').notEmpty().withMessage('Kode voucher wajib diisi'),
  body('purchaseAmount').optional().isNumeric(),
  // [BARU] Validasi items untuk cek layanan spesifik
  body('items').optional().isArray().withMessage('Items harus berupa array'),
  body('items.*.serviceId').optional().notEmpty(),
  body('items.*.price').optional().isNumeric(),
  body('items.*.quantity').optional().isNumeric()
];

// [BARU] Validasi untuk klaim voucher
const validateVoucherClaim = [
  body('code').notEmpty().withMessage('Kode voucher wajib diisi')
];

module.exports = {
  validateVoucherCheck,
  validateVoucherClaim
};