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

module.exports = { validateBody };