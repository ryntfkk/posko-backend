const { addError, respondValidationErrors, normalizeString } = require('../../utils/validation');

function validateCreateRoom(req, res, next) {
  const errors = [];
  const body = req.body || {};

  if (!Array.isArray(body.participants) || body.participants.length === 0) {
    addError(
      errors,
      'participants',
      'validation.participants_required',
      'Participants harus berupa array dan tidak boleh kosong'
    );
  }

  const participants = Array.isArray(body.participants)
    ? body.participants.map((participant, index) => {
        const sanitized = normalizeString(participant);
        if (!sanitized) {
          addError(
            errors,
            `participants[${index}]`,
            'validation.participant_invalid',
            'Peserta harus berupa string yang valid'
          );
        }
        return sanitized;
      })
    : [];

  if (errors.length) {
    return respondValidationErrors(req, res, errors);
  }

  req.body = { ...body, participants };
  return next();
}

module.exports = { validateCreateRoom };