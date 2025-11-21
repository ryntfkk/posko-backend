// File: src/modules/providers/validators.js
// ⬇️ Pastikan baris ini ada! Ini yang mengimpor normalizeString
const { addError, respondValidationErrors, normalizeString } = require('../../utils/validation');

function validateCreateProvider(req, res, next) {
  const errors = [];
  const body = req.body || {};

  // 1. Validasi User ID
  const userId = normalizeString(body.userId);
  if (!userId) {
    addError(errors, 'userId', 'validation.user_id_required', 'userId wajib diisi');
  }

  // 2. Validasi Services (Array of Objects)
  let services = [];
  if (body.services !== undefined && !Array.isArray(body.services)) {
    addError(errors, 'services', 'validation.services_array', 'Services harus berupa array');
  } else if (Array.isArray(body.services)) {
    services = body.services.map((item, index) => {
      // Handle jika user mengirim string ID saja (kesalahan format)
      if (typeof item === 'string') {
        addError(errors, `services[${index}]`, 'validation.service_invalid', 'Format service salah. Harus object { serviceId, price }');
        return null;
      }
      
      // Validasi properti dalam object
      if (!item.serviceId) {
        addError(errors, `services[${index}].serviceId`, 'validation.service_id_required', 'Service ID wajib diisi');
      }
      
      if (typeof item.price !== 'number') {
        addError(errors, `services[${index}].price`, 'validation.price_invalid', 'Harga harus angka');
      }

      return {
        serviceId: item.serviceId,
        price: item.price,
        isActive: item.isActive !== undefined ? item.isActive : true
      };
    }).filter(item => item !== null); // Hapus item yang null (error)
  }

  if (errors.length) {
    return respondValidationErrors(req, res, errors);
  }

  // Update req.body dengan data yang sudah bersih
  req.body = { ...body, userId, services };
  return next();
}

module.exports = { validateCreateProvider };