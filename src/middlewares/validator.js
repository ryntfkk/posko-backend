const { validationResult } = require('express-validator');

// Middleware sederhana untuk memvalidasi field-body yang wajib diisi
function validateBody(requiredFields = []) {
  return (req, res, next) => {
    const missingFields = requiredFields.filter((field) => !req.body[field]);

    if (missingFields.length > 0) {
      const messageKey = 'validation.missing_fields';
      return res.status(400).json({
        messageKey,
        message: req.t
          ? req.t(messageKey, { fields: missingFields.join(', ') })
          : `Field berikut wajib diisi: ${missingFields.join(', ')}`,
        missingFields,
      });
    }

    next();
  };
}

// [TAMBAHAN] Middleware untuk menangkap error dari express-validator
function runValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      messageKey: 'validation.invalid_payload',
      message: 'Data yang dikirim tidak valid',
      errors: errors.array().map(err => ({
        field: err.path,
        message: err.msg
      }))
    });
  }
  next();
}

// Update module.exports
module.exports = { validateBody, runValidation };