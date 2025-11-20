const { addError, respondValidationErrors, normalizeString } = require('../../utils/validation');

function validateCreateReview(req, res, next) {
  const errors = [];
  const body = req.body || {};

  const userId = normalizeString(body.userId);
  if (!userId) {
    addError(errors, 'userId', 'validation.user_id_required', 'userId wajib diisi');
  }

  const providerId = normalizeString(body.providerId);
  if (!providerId) {
    addError(errors, 'providerId', 'validation.provider_id_required', 'providerId wajib diisi');
  }

  const rating = body.rating;
  if (rating === undefined || rating === null) {
    addError(errors, 'rating', 'validation.rating_required', 'Rating wajib diisi');
  } else if (typeof rating !== 'number' || rating < 1 || rating > 5) {
    addError(errors, 'rating', 'validation.rating_invalid', 'Rating harus angka 1-5');
  }

  const comment = normalizeString(body.comment) || '';

  if (errors.length) {
    return respondValidationErrors(req, res, errors);
  }

  req.body = { ...body, userId, providerId, rating, comment };
  return next();
}

module.exports = { validateCreateReview };