const { addError, respondValidationErrors, normalizeString } = require('../../utils/validation');

function validateCreateProvider(req, res, next) {
  const errors = [];
  const body = req.body || {};

  const userId = normalizeString(body.userId);
  if (!userId) {
    addError(errors, 'userId', 'validation.user_id_required', 'userId wajib diisi');
  }

  let services = [];
  if (body.services !== undefined && !Array.isArray(body.services)) {
    addError(errors, 'services', 'validation.services_array', 'Services harus berupa array');
  } else if (Array.isArray(body.services)) {
    services = body.services.map((service, index) => {
      const sanitized = normalizeString(service);
      if (!sanitized) {
        addError(
          errors,
          `services[${index}]`,
          'validation.service_invalid',
          'Layanan harus berupa string yang valid'
        );
      }
      return sanitized;
    });
  }

  if (errors.length) {
    return respondValidationErrors(req, res, errors);
  }

  req.body = { ...body, userId, services };
  return next();
}

module.exports = { validateCreateProvider };