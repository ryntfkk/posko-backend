// Middleware sederhana untuk memvalidasi field-body yang wajib diisi
function validateBody(requiredFields = []) {
  return (req, res, next) => {
    const missingFields = requiredFields.filter((field) => !req.body[field]);

    if (missingFields.length > 0) {
      return res.status(400).json({
        message: `Field berikut wajib diisi: ${missingFields.join(', ')}`,
        missingFields,
      });
    }

    next();
  };
}

module.exports = { validateBody };