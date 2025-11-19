// Middleware penanganan error umum
function errorHandler(err, req, res, next) {
  console.error('Terjadi error:', err);

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