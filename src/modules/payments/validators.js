const { addError, respondValidationErrors, normalizeString } = require('../../utils/validation');

const allowedMethods = ['bank_transfer', 'credit_card', 'cash'];

function validateCreatePayment(req, res, next) {
  const errors = [];
  const body = req.body || {};

  const orderId = normalizeString(body.orderId);
  if (!orderId) {
    addError(errors, 'orderId', 'validation.order_id_required', 'orderId wajib diisi');
  }

  const amount = body.amount;
  if (amount === undefined || amount === null) {
    addError(errors, 'amount', 'validation.amount_required', 'Jumlah pembayaran wajib diisi');
  } else if (typeof amount !== 'number' || Number.isNaN(amount) || amount < 0) {
    addError(errors, 'amount', 'validation.amount_invalid', 'Jumlah pembayaran harus angka tidak negatif');
  }

  const method = normalizeString(body.method) || 'bank_transfer';
  if (method && !allowedMethods.includes(method)) {
    addError(errors, 'method', 'validation.method_invalid', 'Metode pembayaran tidak valid');
  }

  if (errors.length) {
    return respondValidationErrors(req, res, errors);
  }

  req.body = { ...body, orderId, amount, method };
  return next();
}

module.exports = { validateCreatePayment };