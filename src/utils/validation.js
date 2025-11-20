function addError(errors, field, messageKey, defaultMessage, messageData) {
  errors.push({ field, messageKey, defaultMessage, messageData });
}

function translateErrors(req, errors) {
  return errors.map((error) => ({
    field: error.field,
    messageKey: error.messageKey,
    message: req.t
      ? req.t(error.messageKey, error.messageData)
      : error.defaultMessage,
  }));
}

function respondValidationErrors(
  req,
  res,
  errors,
  { messageKey = 'validation.invalid_payload', defaultMessage = 'Payload tidak valid' } = {}
) {
  const message = req.t ? req.t(messageKey) : defaultMessage;

  return res.status(400).json({
    messageKey,
    message,
    errors: translateErrors(req, errors),
  });
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizeEmail(email) {
  return normalizeString(email)?.toLowerCase() || '';
}

module.exports = {
  addError,
  translateErrors,
  respondValidationErrors,
  normalizeString,
  normalizeEmail,
};