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

// [FITUR BARU] Validasi Update Jadwal
function validateUpdateSchedule(req, res, next) {
  const errors = [];
  const body = req.body; // Ekspektasi: Array of ScheduleDay

  if (!Array.isArray(body)) {
    addError(errors, 'schedule', 'validation.schedule_array', 'Jadwal harus berupa array');
    return respondValidationErrors(req, res, errors);
  }

  // Validasi setiap item jadwal
  body.forEach((day, index) => {
    if (typeof day.dayIndex !== 'number' || day.dayIndex < 0 || day.dayIndex > 6) {
      addError(errors, `schedule[${index}].dayIndex`, 'validation.day_index_invalid', 'dayIndex harus angka 0-6');
    }
    if (!day.dayName) {
      addError(errors, `schedule[${index}].dayName`, 'validation.day_name_required', 'dayName wajib diisi');
    }
    // Validasi format jam sederhana (Regex HH:mm)
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (day.isOpen) {
        if (!day.start || !timeRegex.test(day.start)) {
            addError(errors, `schedule[${index}].start`, 'validation.start_invalid', 'Format jam mulai salah (HH:mm)');
        }
        if (!day.end || !timeRegex.test(day.end)) {
            addError(errors, `schedule[${index}].end`, 'validation.end_invalid', 'Format jam selesai salah (HH:mm)');
        }
    }
  });

  if (errors.length) {
    return respondValidationErrors(req, res, errors);
  }

  return next();
}

module.exports = { validateCreateProvider, validateUpdateSchedule };