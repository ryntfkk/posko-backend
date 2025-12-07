const { body } = require('express-validator');

const validatePayoutRequest = [
  body('amount')
    .notEmpty().withMessage('Nominal pencairan wajib diisi')
    .isNumeric().withMessage('Nominal harus berupa angka')
    .toFloat()
    .custom((value) => {
      if (value < 10000) {
        throw new Error('Minimal pencairan dana adalah Rp 10.000');
      }
      return true;
    })
];

module.exports = {
  validatePayoutRequest
};