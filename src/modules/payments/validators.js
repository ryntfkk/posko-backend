const { addError, respondValidationErrors, normalizeString } = require('../../utils/validation');

// [PERBAIKAN] Tambahkan 'midtrans_snap' ke sini juga
const allowedMethods = ['bank_transfer', 'credit_card', 'cash', 'midtrans_snap'];

function validateCreatePayment(req, res, next) {
  const errors = [];
  const body = req.body || {};

  const orderId = normalizeString(body.orderId);
  if (!orderId) {
    addError(errors, 'orderId', 'validation.order_id_required', 'orderId wajib diisi');
  }

  // Validasi amount dihapus di sini karena di-handle controller (seperti rencana sebelumnya), 
  // tapi jika masih ada sisa kode lama, pastikan method-nya sinkron.
  
  const method = normalizeString(body.method);
  // Jika user mengirim method manual, pastikan valid
  if (method && !allowedMethods.includes(method)) {
    addError(errors, 'method', 'validation.method_invalid', 'Metode pembayaran tidak valid');
  }

  if (errors.length) {
    return respondValidationErrors(req, res, errors);
  }

  req.body = { ...body, orderId };
  return next();
}

module.exports = { validateCreatePayment };