const { addError, respondValidationErrors, normalizeString } = require('../../utils/validation');

const VALID_UNITS = ['unit', 'jam', 'hari', 'meter', 'kg', 'paket', 'orang', 'ruangan', 'kendaraan'];

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

  // ✅ [BARU] Validasi unit
  const unit = normalizeString(body.unit) || 'unit';
  if (! VALID_UNITS.includes(unit)) {
    addError(errors, 'unit', 'validation.unit_invalid', `Satuan tidak valid. Pilih: ${VALID_UNITS.join(', ')}`);
  }

  if (errors.length) {
    return respondValidationErrors(req, res, errors);
  }

  req.body = { 
    ...body, 
    name, 
    category, 
    basePrice,
    unit, // ✅ [BARU]
    unitLabel: normalizeString(body.unitLabel) || '', // ✅ [BARU]
    description: normalizeString(body.description) || '',
    iconUrl: normalizeString(body.iconUrl) || ''
  };
  
  return next();
}

module.exports = { validateCreateService };