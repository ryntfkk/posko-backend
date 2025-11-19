// Middleware penanganan error umum
function errorHandler(err, req, res, next) {
  console.error('Terjadi error:', err);

  const status = err.status || 500;
  const message = err.message || 'Terjadi kesalahan pada server';

  res.status(status).json({
    message,
  });
}

module.exports = errorHandler;