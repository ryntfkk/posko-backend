// File: src/modules/providers/validators.js
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

// [FITUR BARU] Validasi Update Ketersediaan (Blocked Dates)
function validateUpdateAvailability(req, res, next) {
  const errors = [];
  const body = req.body || {};
  
  const blockedDates = body.blockedDates;

  // blockedDates wajib dikirim sebagai array (bisa array kosong untuk reset)
  if (blockedDates === undefined || !Array.isArray(blockedDates)) {
    addError(errors, 'blockedDates', 'validation.blocked_dates_array', 'Blocked dates harus berupa array');
  } else {
    // Validasi isi array harus format tanggal valid
    blockedDates.forEach((date, index) => {
      if (!Date.parse(date)) {
        addError(errors, `blockedDates[${index}]`, 'validation.date_invalid', 'Format tanggal tidak valid (Gunakan format ISO 8601)');
      }
    });
  }

  if (errors.length) {
    return respondValidationErrors(req, res, errors);
  }

  return next();
}

module.exports = { validateCreateProvider, validateUpdateAvailability };