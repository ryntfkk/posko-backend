// Middleware penanganan error umum
function errorHandler(err, req, res, next) {
  console.error('Terjadi error:', err);

    if (err?.code === 11000 && err?.keyPattern?.email) {
    const messageKey = 'auth.email_exists';
    const message = req.t
      ? req.t(messageKey)
      : 'Email sudah terdaftar';

    return res.status(409).json({
      messageKey,
      message,
    });
  }

  const status = err.status || 500;
  const messageKey = err.messageKey || 'errors.internal';
  const message = req.t
    ? req.t(messageKey, err.messageData)
    : err.message || 'Terjadi kesalahan pada server';

  res.status(status).json({
    messageKey,
    message,
  });
}

module.exports = errorHandler;