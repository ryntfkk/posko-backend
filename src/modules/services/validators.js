const { addError, respondValidationErrors, normalizeString } = require('../../utils/validation');

function validateCreateService(req, res, next) {
  const errors = [];
  const body = req.body || {};

  const name = normalizeString(body.name);
  if (!name) {
    addError(errors, 'name', 'validation.name_required', 'Nama layanan wajib diisi');
  }

  const category = normalizeString(body.category);
  if (!category) {
    addError(errors, 'category', 'validation.category_required', 'Kategori layanan wajib diisi');
  }

  const basePrice = body.basePrice;
  if (basePrice === undefined || basePrice === null) {
    addError(errors, 'basePrice', 'validation.price_required', 'Harga dasar wajib diisi');
  } else if (typeof basePrice !== 'number' || basePrice < 0) {
    addError(errors, 'basePrice', 'validation.price_invalid', 'Harga dasar harus angka positif');
  }

  if (errors.length) {
    return respondValidationErrors(req, res, errors);
  }

  req.body = { 
    ...body, 
    name, 
    category, 
    basePrice,
    description: normalizeString(body.description) || '',
    iconUrl: normalizeString(body.iconUrl) || ''
  };
  
  return next();
}

module.exports = { validateCreateService };